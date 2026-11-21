// Onboarding form with client-side validation.
//
// Validation model (kept deliberately simple so the properties in
// bombadil/web.spec.ts stay easy to reason about):
//   - Every field is required and trimmed before checking.
//   - The email field must match a conventional pattern.
//   - An error message is only ever shown for a field that is currently
//     invalid; it disappears as soon as the field becomes valid.
//   - Submitting with invalid fields keeps the form visible and marks the
//     invalid fields; submitting with valid fields swaps in the success
//     panel and raises a toast in the top-right corner.
//   - The toast auto-dismisses after 5 seconds.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const form = document.getElementById("onboarding-form");
const successPanel = document.getElementById("success-panel");
const successMessage = document.getElementById("success-message");
const resetButton = document.getElementById("reset-button");
const toast = document.getElementById("toast");

const fields = [
  { id: "first-name", label: "First name", validate: (v) => (v === "" ? "First name is required." : "") },
  { id: "last-name", label: "Last name", validate: (v) => (v === "" ? "Last name is required." : "") },
  { id: "email", label: "Email", validate: (v) => {
      if (v === "") return "Email is required.";
      return EMAIL_PATTERN.test(v) ? "" : "Enter a valid email address.";
    } },
  { id: "address", label: "Address", validate: (v) => (v === "" ? "Address is required." : "") },
];

// Fields the user has interacted with; we only show errors for these.
const touched = new Set();

function inputValue(id) {
  return document.getElementById(id).value.trim();
}

function fieldError(id) {
  const spec = fields.find((f) => f.id === id);
  return spec.validate(inputValue(id));
}

function renderField(id) {
  const input = document.getElementById(id);
  const errorEl = document.querySelector(`[data-error-for="${id}"]`);
  const message = fieldError(id);
  const showError = touched.has(id) && message !== "";

  errorEl.textContent = showError ? message : "";
  errorEl.hidden = !showError;
  input.setAttribute("aria-invalid", showError ? "true" : "false");
}

function renderAll() {
  fields.forEach((f) => renderField(f.id));
}

let toastTimer = null;

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    toastTimer = null;
  }, 5000);
}

function showSuccess() {
  form.hidden = true;
  successPanel.hidden = false;
  successMessage.textContent = `Welcome aboard, ${inputValue("first-name")}!`;
  showToast(`Account created for ${inputValue("email")}.`);
}

fields.forEach((f) => {
  const input = document.getElementById(f.id);
  // Validate live once the user has touched the field, so errors clear as
  // soon as the value becomes valid.
  input.addEventListener("input", () => {
    touched.add(f.id);
    renderField(f.id);
  });
  input.addEventListener("blur", () => {
    touched.add(f.id);
    renderField(f.id);
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  let valid = true;
  fields.forEach((f) => {
    touched.add(f.id);
    if (fieldError(f.id) !== "") valid = false;
  });
  renderAll();

  if (valid) showSuccess();
});

resetButton.addEventListener("click", () => {
  form.reset();
  touched.clear();
  successPanel.hidden = true;
  form.hidden = false;
  renderAll();
  document.getElementById("first-name").focus();
});

renderAll();
