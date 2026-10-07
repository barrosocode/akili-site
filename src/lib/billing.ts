export type PackagePrice = {
  uuid: string;
  audience: string;
  currency: string;
  price_cents: number;
  billing_period: string;
};

export type PackageSkill = string | { name?: string; title?: string; label?: string };

export type FamilyPackage = {
  uuid: string;
  name: string;
  slug: string;
  description: string | null;
  package_type: string;
  status: string;
  prices: PackagePrice[];
  skills: PackageSkill[];
  version: {
    uuid: string;
    version: number;
    title: string;
    description: string | null;
  } | null;
};

export type PackagesPage = {
  data: FamilyPackage[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
};

export type ChargeStatus = "pending" | "paid" | "expired" | "cancelled" | "failed" | "refunded";

export type PixCharge = {
  uuid: string;
  status: ChargeStatus;
  buyer_name: string;
  buyer_email: string;
  amount_cents: number;
  currency: string;
  package: {
    uuid: string;
    name: string;
  };
  pix: {
    qr_code: string | null;
    qr_code_url: string | null;
    expires_at: string | null;
  } | null;
  paid_at: string | null;
  refunded_at: string | null;
  guardian_uuid: string | null;
};

export type ChargeEnvelope = {
  status: number;
  message: string;
  errors: Record<string, string[]>;
  charge: PixCharge;
  pagination: null;
  error_code: string | null;
};

export type ChargeRequest = {
  name: string;
  email: string;
  cpf: string;
  package_uuid: string;
};

const PERIOD_LABELS: Record<string, string> = {
  one_time: "pagamento único",
  monthly: "por mês",
  yearly: "por ano",
  weekly: "por semana",
};

const ACCESS_DEADLINE = new Date("2026-12-31T23:59:59-03:00");

export class ApiError extends Error {
  readonly status: number;
  readonly errors: Record<string, string[]>;
  readonly detail: string;

  constructor(status: number, detail: string, errors: Record<string, string[]> = {}) {
    super(detail || "Erro na API");
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.errors = errors;
  }
}

export function apiBase(): string {
  const configured = import.meta.env.PUBLIC_API_BASE_URL || "http://localhost:8000";
  return configured.replace(/\/$/, "");
}

export function familyPrice(pkg: FamilyPackage): PackagePrice | null {
  const prices = pkg.prices ?? [];
  const oneTime = prices.find((price) => price.audience === "family" && price.billing_period === "one_time");
  if (oneTime) return oneTime;
  return prices.find((price) => price.audience === "family") ?? null;
}

export function packageBlurb(pkg: FamilyPackage): string {
  const description = pkg.description?.trim();
  if (description) return description;
  return pkg.version?.description?.trim() ?? "";
}

export function skillLabels(skills: PackageSkill[] | null | undefined): string[] {
  if (!skills?.length) return [];
  const labels: string[] = [];
  for (const skill of skills) {
    if (typeof skill === "string") {
      const text = skill.trim();
      if (text) labels.push(text);
      continue;
    }
    const text = skill?.name?.trim() || skill?.title?.trim() || skill?.label?.trim() || "";
    if (text) labels.push(text);
  }
  return labels;
}

export function featuredPackageUuid(packages: FamilyPackage[]): string | null {
  const priced = packages
    .map((pkg, index) => ({ pkg, index, price: familyPrice(pkg) }))
    .filter((item): item is { pkg: FamilyPackage; index: number; price: PackagePrice } => item.price !== null);

  if (priced.length < 2) return null;

  priced.sort((a, b) => {
    const byPrice = b.price.price_cents - a.price.price_cents;
    if (byPrice !== 0) return byPrice;
    const bySkills = skillLabels(b.pkg.skills).length - skillLabels(a.pkg.skills).length;
    if (bySkills !== 0) return bySkills;
    return b.index - a.index;
  });

  return priced[0]?.pkg.uuid ?? null;
}

export function formatCents(cents: number, currency = "BRL"): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency,
  });
}

export function periodLabel(billingPeriod: string): string {
  return PERIOD_LABELS[billingPeriod] ?? billingPeriod;
}

export function dailyPriceLine(cents: number, now = new Date()): string | null {
  const remainingMs = ACCESS_DEADLINE.getTime() - now.getTime();
  if (remainingMs <= 0) return null;
  const days = Math.ceil(remainingMs / 86_400_000);
  const perDayCents = Math.ceil(cents / days);
  return `Menos de ${formatCents(perDayCents)} por dia até o fim do ano!`;
}

const SAO_PAULO_OFFSET = "-03:00";

export function pixDeadline(expiresAt: string): number {
  const trimmed = expiresAt.trim();
  // O contrato usa o relógio de São Paulo. Um offset zero é esse relógio marcado como UTC.
  if (/(?:Z|\+00:00)$/i.test(trimmed)) {
    const wallClock = trimmed.replace(/(?:Z|\+00:00)$/i, "");
    return new Date(`${wallClock}${SAO_PAULO_OFFSET}`).getTime();
  }
  return new Date(trimmed).getTime();
}

export function pixExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const deadline = pixDeadline(expiresAt);
  return Number.isNaN(deadline) || deadline <= now;
}

export function cpfDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 11);
}

export function maskCpf(value: string): string {
  const digits = cpfDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function isValidCpf(value: string): boolean {
  const digits = cpfDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;

  const checkDigit = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return checkDigit(9) === Number(digits[9]) && checkDigit(10) === Number(digits[10]);
}

export function fieldError(errors: Record<string, string[]> | undefined, field: string): string {
  const messages = errors?.[field];
  if (!messages?.length) return "";
  return messages[0] ?? "";
}

export async function listFamilyPackages(): Promise<FamilyPackage[]> {
  const collected: FamilyPackage[] = [];
  let page = 1;
  let lastPage = 1;

  do {
    const url = new URL("/api/v1/guardian/packages", apiBase());
    url.searchParams.set("offer_audience", "family");
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "100");

    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    const body = await readJson(response);
    if (!response.ok) throw toApiError(response.status, body);

    const parsed = body as PackagesPage;
    const items = Array.isArray(parsed?.data) ? parsed.data : [];
    collected.push(...items);
    lastPage = Number(parsed?.meta?.last_page ?? 1);
    if (items.length === 0) break;
    page += 1;
  } while (page <= lastPage && page <= 20);

  return collected;
}

export async function createPixCharge(input: ChargeRequest): Promise<ChargeEnvelope> {
  const response = await fetch(new URL("/api/v1/billing/pix/charges", apiBase()), {
    method: "POST",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      cpf: cpfDigits(input.cpf),
      package_uuid: input.package_uuid,
    }),
  });
  const body = await readJson(response);
  if (!response.ok) throw toApiError(response.status, body);
  return asEnvelope(body, response.status);
}

export async function getPixCharge(uuid: string): Promise<ChargeEnvelope> {
  const response = await fetch(new URL(`/api/v1/billing/pix/charges/${uuid}`, apiBase()), {
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  const body = await readJson(response);
  if (!response.ok) throw toApiError(response.status, body);
  return asEnvelope(body, response.status);
}

function asEnvelope(body: unknown, status: number): ChargeEnvelope {
  const envelope = body as ChargeEnvelope;
  if (!envelope?.charge?.uuid) {
    throw new ApiError(status, "A resposta da cobrança veio incompleta.");
  }
  return envelope;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const problem = (body ?? {}) as {
    detail?: string;
    title?: string;
    errors?: unknown;
  };
  const detail = problem.detail || problem.title || fallbackDetail(status);
  return new ApiError(status, detail, normalizeErrors(problem.errors));
}

function fallbackDetail(status: number): string {
  if (status === 429) return "Muitas tentativas. Aguarde um pouco e tente de novo.";
  if (status === 404) return "Não encontramos esta cobrança.";
  if (status === 502) return "Não foi possível criar a cobrança PIX.";
  if (status === 503) return "Não foi possível concluir o cadastro do responsável.";
  return "Não foi possível concluir a operação.";
}

function normalizeErrors(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object") return {};
  const errors: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      errors[field] = value.map((item) => String(item));
    } else if (typeof value === "string") {
      errors[field] = [value];
    }
  }
  return errors;
}
