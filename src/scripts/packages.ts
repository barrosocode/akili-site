import QRCode from "qrcode";
import {
  ApiError,
  createPixCharge,
  dailyPriceLine,
  familyPrice,
  featuredPackageUuid,
  fieldError,
  formatCents,
  getPixCharge,
  isValidCpf,
  listFamilyPackages,
  maskCpf,
  packageBlurb,
  periodLabel,
  pixDeadline,
  pixExpired,
  skillLabels,
  type ChargeEnvelope,
  type FamilyPackage,
  type PixCharge,
} from "../lib/billing";

const DEFAULT_BENEFITS = [
  "Cronograma diário até as provas",
  "5 camadas de prática por tópico",
  "Sistema de Medalhas e Painel Familiar",
];

const PLAIN_CARD = ["border-ink/10", "shadow-[0_16px_50px_-42px_rgba(30,52,107,0.4)]"];
const FEATURED_CARD = ["border-ink", "shadow-[0_25px_65px_-35px_rgba(30,52,107,0.55)]", "lg:-translate-y-2"];

const POLL_MS = 4_000;

let selectedPackage: FamilyPackage | null = null;
let chargeEnvelope: ChargeEnvelope | null = null;
let pollTimer = 0;
let clockTimer = 0;
let polling = false;
let requestInFlight = false;

export function mountPackages(): void {
  const grid = document.querySelector<HTMLElement>("#pacotes");
  if (!grid) return;

  void loadPackages(grid);
  bindCheckout();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void pollCharge();
  });
}

async function loadPackages(grid: HTMLElement): Promise<void> {
  grid.replaceChildren(statusNode("Carregando planos…"));
  try {
    const packages = await listFamilyPackages();
    renderPackages(grid, packages);
  } catch (error) {
    renderLoadError(grid, error);
  }
}

function renderPackages(grid: HTMLElement, packages: FamilyPackage[]): void {
  if (packages.length === 0) {
    grid.replaceChildren(statusNode("Nenhum plano familiar disponível no momento."));
    hideCheckout();
    return;
  }

  const featured = featuredPackageUuid(packages);
  const template = document.querySelector<HTMLTemplateElement>("#pacote-template");
  const benefitTemplate = document.querySelector<HTMLTemplateElement>("#beneficio-template");
  if (!template || !benefitTemplate) return;

  const fragment = document.createDocumentFragment();
  for (const pkg of packages) {
    fragment.append(renderCard(pkg, pkg.uuid === featured, template, benefitTemplate));
  }
  grid.replaceChildren(fragment);
}

function renderCard(
  pkg: FamilyPackage,
  featured: boolean,
  template: HTMLTemplateElement,
  benefitTemplate: HTMLTemplateElement,
): HTMLElement {
  const card = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
  const price = familyPrice(pkg);
  const name = pkg.name?.trim() || "Plano Akili";

  card.querySelector("[data-name]")!.textContent = name;
  card.querySelector("[data-description]")!.textContent = packageBlurb(pkg);

  const badge = card.querySelector<HTMLElement>("[data-badge]");
  badge?.classList.toggle("hidden", !featured);
  card.classList.remove(...PLAIN_CARD, ...FEATURED_CARD);
  card.classList.add(...(featured ? FEATURED_CARD : PLAIN_CARD));

  const priceNode = card.querySelector("[data-price]");
  const periodNode = card.querySelector("[data-period]");
  const dailyNode = card.querySelector("[data-daily]");
  if (price) {
    if (priceNode) priceNode.textContent = formatCents(price.price_cents, price.currency);
    if (periodNode) periodNode.textContent = periodLabel(price.billing_period);
    if (dailyNode) dailyNode.textContent = dailyPriceLine(price.price_cents) ?? "";
  } else {
    if (priceNode) priceNode.textContent = "Preço indisponível";
    if (periodNode) periodNode.textContent = "";
    if (dailyNode) dailyNode.textContent = "";
  }

  const benefits = card.querySelector("[data-benefits]");
  const labels = skillLabels(pkg.skills);
  const items = labels.length > 0 ? labels : DEFAULT_BENEFITS;
  if (benefits) {
    benefits.replaceChildren(
      ...items.map((label) => {
        const item = benefitTemplate.content.firstElementChild?.cloneNode(true) as HTMLElement;
        const slot = item.querySelector("[data-benefit]");
        if (slot) slot.textContent = label;
        return item;
      }),
    );
  }

  const button = card.querySelector<HTMLButtonElement>("[data-cta]");
  const label = card.querySelector("[data-cta-label]");
  if (label) label.textContent = `ASSINAR ${name.toLocaleUpperCase("pt-BR")} AGORA`;
  if (button) {
    button.disabled = !price;
    button.addEventListener("click", () => openCheckout(pkg));
  }

  return card;
}

function renderLoadError(grid: HTMLElement, error: unknown): void {
  const message =
    error instanceof ApiError && error.status === 429
      ? "Muitas consultas agora. Aguarde um minuto e tente de novo."
      : "Não foi possível carregar os planos. Tente novamente.";
  const wrapper = document.createElement("div");
  wrapper.className = "col-span-full flex flex-col items-center gap-4 text-center";
  const text = statusNode(message);
  text.classList.remove("col-span-full");
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "inline-flex min-h-12 items-center justify-center rounded-full bg-leaf px-5 text-xs font-extrabold tracking-[0.06em] text-white transition hover:bg-forest";
  button.textContent = "TENTAR NOVAMENTE";
  button.addEventListener("click", () => void loadPackages(grid));
  wrapper.append(text, button);
  grid.replaceChildren(wrapper);
  hideCheckout();
}

function openCheckout(pkg: FamilyPackage): void {
  selectedPackage = pkg;
  resetChargeView();

  const checkout = document.querySelector<HTMLElement>("#checkout");
  const name = document.querySelector<HTMLElement>("#checkout-package-name");
  if (name) name.textContent = pkg.name;
  checkout?.classList.remove("hidden");
  checkout?.scrollIntoView({ behavior: "smooth", block: "start" });

  const nameInput = document.querySelector<HTMLInputElement>("#checkout-name");
  if (nameInput && !nameInput.value) nameInput.focus();
}

function bindCheckout(): void {
  const form = document.querySelector<HTMLFormElement>("#checkout-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitCharge(form);
  });

  document.querySelector("#pix-copy")?.addEventListener("click", () => void copyPixCode());
  document.querySelector("#pix-retry")?.addEventListener("click", () => resetChargeView());
  document.querySelector("#pix-consult")?.addEventListener("click", () => {
    resumePolling();
    void pollCharge();
  });

  const cpfInput = document.querySelector<HTMLInputElement>("#checkout-cpf");
  cpfInput?.addEventListener("input", () => {
    const masked = maskCpf(cpfInput.value);
    if (cpfInput.value !== masked) cpfInput.value = masked;
  });
}

async function submitCharge(form: HTMLFormElement): Promise<void> {
  clearFieldErrors();
  const name = valueOf(form, "name");
  const email = valueOf(form, "email");
  const cpf = valueOf(form, "cpf");
  const packageUuid = selectedPackage?.uuid ?? "";
  const localErrors = validateCharge(name, email, cpf, packageUuid);
  if (Object.keys(localErrors).length > 0) {
    showFieldErrors(localErrors);
    return;
  }

  const submit = form.querySelector<HTMLButtonElement>("[data-submit]");
  if (submit) {
    submit.disabled = true;
    submit.textContent = "GERANDO PIX…";
  }

  try {
    stopPolling();
    chargeEnvelope = await createPixCharge({ name, email, cpf, package_uuid: packageUuid });
    showCharge(chargeEnvelope.charge);
    if (chargeEnvelope.charge.status === "pending" && !pixExpired(chargeEnvelope.charge.pix?.expires_at)) {
      resumePolling();
    }
  } catch (error) {
    handleChargeError(error, "create");
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = "GERAR PIX";
    }
  }
}

function validateCharge(name: string, email: string, cpf: string, packageUuid: string): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!name) errors.name = ["Informe o nome."];
  else if (name.length > 255) errors.name = ["O nome deve ter no máximo 255 caracteres."];

  if (!email) errors.email = ["Informe o e-mail."];
  else if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = ["Informe um e-mail válido."];

  if (!cpf.replace(/\D/g, "")) errors.cpf = ["Informe o CPF."];
  else if (!isValidCpf(cpf)) errors.cpf = ["O CPF informado é inválido."];

  if (!packageUuid) errors.package_uuid = ["Informe o pacote."];
  return errors;
}

function showCharge(charge: PixCharge): void {
  const form = document.querySelector<HTMLElement>("#checkout-form");
  const result = document.querySelector<HTMLElement>("#pix-result");
  form?.classList.add("hidden");
  result?.classList.remove("hidden");

  const amount = document.querySelector("#pix-amount");
  if (amount) amount.textContent = formatCents(charge.amount_cents, charge.currency);

  const packageName = document.querySelector("#pix-package");
  if (packageName) packageName.textContent = charge.package?.name ?? selectedPackage?.name ?? "";

  const locallyExpired = charge.status === "pending" && pixExpired(charge.pix?.expires_at);
  const status = locallyExpired ? "expired" : charge.status;
  setStatusMessage(statusMessage(status));

  const pending = status === "pending";
  toggle("#pix-pending", pending);
  toggle("#pix-retry", status === "expired" || status === "failed" || status === "cancelled");
  toggle("#pix-consult", false);

  if (!pending) {
    clearPixSecrets();
    stopClock();
    return;
  }

  void paintQr(charge);
  const code = document.querySelector<HTMLInputElement>("#pix-code");
  if (code && !code.value) code.value = charge.pix?.qr_code ?? "";
  updateCountdown();
  if (!clockTimer) startClock();
}

async function paintQr(charge: PixCharge): Promise<void> {
  const image = document.querySelector<HTMLImageElement>("#pix-qr");
  if (!image) return;
  if (image.dataset.charge === charge.uuid && image.getAttribute("src")) return;
  image.dataset.charge = charge.uuid;
  const pix = charge.pix;
  image.onload = null;
  image.onerror = null;

  if (pix?.qr_code_url) {
    image.alt = "QR Code do Pix";
    image.src = pix.qr_code_url;
    image.onerror = () => {
      if (pix.qr_code) void paintGeneratedQr(image, pix.qr_code);
    };
    return;
  }

  if (pix?.qr_code) {
    await paintGeneratedQr(image, pix.qr_code);
    return;
  }

  image.removeAttribute("src");
}

async function paintGeneratedQr(image: HTMLImageElement, code: string): Promise<void> {
  image.alt = "QR Code do Pix";
  image.src = await QRCode.toDataURL(code, { margin: 1, width: 280 });
}

function startClock(): void {
  stopClock();
  clockTimer = window.setInterval(updateCountdown, 1_000);
}

function stopClock(): void {
  if (clockTimer) window.clearInterval(clockTimer);
  clockTimer = 0;
}

function updateCountdown(): void {
  const node = document.querySelector("#pix-countdown");
  const expiresAt = chargeEnvelope?.charge.pix?.expires_at;
  if (!node) return;
  if (!expiresAt) {
    node.textContent = "";
    return;
  }
  const diff = pixDeadline(expiresAt) - Date.now();
  if (diff <= 0) {
    node.textContent = "O prazo do Pix acabou.";
    if (chargeEnvelope?.charge.status === "pending") {
      stopPolling();
      showCharge({ ...chargeEnvelope.charge, status: "pending" });
    }
    return;
  }
  const totalSeconds = Math.floor(diff / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  node.textContent = `Expira em ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function resumePolling(): void {
  stopPolling();
  polling = true;
  pollTimer = window.setInterval(() => void pollCharge(), POLL_MS);
}

function stopPolling(): void {
  polling = false;
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = 0;
}

async function pollCharge(): Promise<void> {
  const uuid = chargeEnvelope?.charge.uuid;
  if (!uuid || !polling || requestInFlight) return;
  if (chargeEnvelope && pixExpired(chargeEnvelope.charge.pix?.expires_at)) {
    stopPolling();
    showCharge(chargeEnvelope.charge);
    return;
  }

  requestInFlight = true;
  try {
    chargeEnvelope = await getPixCharge(uuid);
    const status = chargeEnvelope.charge.status;
    if (status !== "pending" || pixExpired(chargeEnvelope.charge.pix?.expires_at)) {
      stopPolling();
    }
    showCharge(chargeEnvelope.charge);
  } catch (error) {
    handleChargeError(error, "poll");
  } finally {
    requestInFlight = false;
  }
}

function handleChargeError(error: unknown, phase: "create" | "poll"): void {
  if (!(error instanceof ApiError)) {
    setFormAlert("Não foi possível falar com a Akili. Tente novamente.");
    if (phase === "poll") {
      stopPolling();
      showConsultRetry();
    }
    return;
  }

  if (error.status === 422) {
    showFieldErrors(error.errors);
    const formAlert = fieldError(error.errors, "package_uuid") || error.detail;
    if (!fieldError(error.errors, "name") && !fieldError(error.errors, "email") && !fieldError(error.errors, "cpf")) {
      setFormAlert(formAlert);
    }
    return;
  }

  if (error.status === 404) {
    stopPolling();
    clearPixSecrets();
    hideCheckout();
    setStatusMessage("Não encontramos esta cobrança.");
    document.querySelector("#pix-result")?.classList.remove("hidden");
    document.querySelector("#checkout")?.classList.remove("hidden");
    document.querySelector("#checkout-form")?.classList.add("hidden");
    toggle("#pix-pending", false);
    toggle("#pix-retry", false);
    return;
  }

  if (error.status === 429) {
    stopPolling();
    const message = "Muitas tentativas. Aguarde um pouco antes de continuar.";
    if (phase === "create") setFormAlert(message);
    else {
      setStatusMessage(message);
      showConsultRetry();
    }
    return;
  }

  if (error.status === 503 && phase === "poll") {
    setStatusMessage(error.detail || "Não foi possível concluir o cadastro do responsável.");
    return;
  }

  if (error.status === 502) {
    const message = error.detail || (phase === "create" ? "Não foi possível criar a cobrança PIX." : "Não foi possível consultar a cobrança PIX.");
    if (phase === "create") setFormAlert(message);
    else {
      stopPolling();
      setStatusMessage(message);
      showConsultRetry();
    }
    return;
  }

  const message = error.detail || "Não foi possível concluir a operação.";
  if (phase === "create") setFormAlert(message);
  else {
    stopPolling();
    setStatusMessage(message);
    showConsultRetry();
  }
}

function showConsultRetry(): void {
  toggle("#pix-consult", true);
}

async function copyPixCode(): Promise<void> {
  const code = document.querySelector<HTMLInputElement>("#pix-code")?.value ?? "";
  const feedback = document.querySelector("#pix-copy-feedback");
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    if (feedback) feedback.textContent = "Código copiado.";
  } catch {
    if (feedback) feedback.textContent = "Selecione o código e copie.";
  }
}

function resetChargeView(): void {
  stopPolling();
  stopClock();
  chargeEnvelope = null;
  clearPixSecrets();
  clearFieldErrors();
  document.querySelector("#checkout-form")?.classList.remove("hidden");
  document.querySelector("#pix-result")?.classList.add("hidden");
  toggle("#pix-consult", false);
  const countdown = document.querySelector("#pix-countdown");
  if (countdown) countdown.textContent = "";
  const feedback = document.querySelector("#pix-copy-feedback");
  if (feedback) feedback.textContent = "";
}

function hideCheckout(): void {
  resetChargeView();
  selectedPackage = null;
  document.querySelector("#checkout")?.classList.add("hidden");
}

function clearPixSecrets(): void {
  const image = document.querySelector<HTMLImageElement>("#pix-qr");
  if (image) {
    image.removeAttribute("src");
    image.alt = "";
    delete image.dataset.charge;
  }
  const code = document.querySelector<HTMLInputElement>("#pix-code");
  if (code) code.value = "";
}

function clearFieldErrors(): void {
  for (const field of ["name", "email", "cpf", "package_uuid", "form"]) {
    const node = document.querySelector(`[data-error-for="${field}"]`);
    if (node) node.textContent = "";
    const input = document.querySelector<HTMLInputElement>(`[name="${field}"]`);
    input?.removeAttribute("aria-invalid");
  }
}

function showFieldErrors(errors: Record<string, string[]>): void {
  for (const field of ["name", "email", "cpf", "package_uuid"]) {
    const message = fieldError(errors, field);
    const node = document.querySelector(`[data-error-for="${field}"]`);
    if (node) node.textContent = message;
    const input = document.querySelector<HTMLInputElement>(`[name="${field}"]`);
    if (input) {
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }
  const firstInvalid = document.querySelector<HTMLElement>("[aria-invalid='true']");
  firstInvalid?.focus();
}

function setFormAlert(message: string): void {
  const node = document.querySelector("[data-error-for='form']");
  if (node) node.textContent = message;
}

function setStatusMessage(message: string): void {
  const node = document.querySelector("#pix-status");
  if (node) node.textContent = message;
}

function statusMessage(status: string): string {
  switch (status) {
    case "pending":
      return "Pague com o QR Code ou com o código copia e cola.";
    case "paid":
      return "Pagamento confirmado. Abra o e-mail e conclua o primeiro acesso com o código que enviamos.";
    case "expired":
      return "O prazo do Pix acabou. Você pode gerar outra cobrança.";
    case "cancelled":
      return "A cobrança foi cancelada antes do pagamento.";
    case "failed":
      return "Não foi possível cobrar. Você pode tentar de novo.";
    case "refunded":
      return "O valor desta cobrança foi estornado.";
    default:
      return "Acompanhe o status do pagamento.";
  }
}

function statusNode(message: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.id = "pacotes-status";
  paragraph.className = "col-span-full text-center text-sm font-semibold text-muted";
  paragraph.textContent = message;
  return paragraph;
}

function valueOf(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement) return field.value.trim();
  return "";
}

function toggle(selector: string, visible: boolean): void {
  document.querySelector(selector)?.classList.toggle("hidden", !visible);
}
