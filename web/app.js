// Onboarding form: client-side validation, a success summary and a toast.
//
// Rules (also written out, independently, in specs/web.spec.ts):
//   first / last name  1-50 characters after trimming; letters, spaces,
//                      hyphens and apostrophes; starts with a letter
//   email              something@domain.tld, no spaces, at most 254 characters
//   address            5-200 characters after trimming
//
// A field shows its error once it is "touched" (typed in, left, or the form
// was submitted). A valid submit shows the summary and a toast, then resets
// the form.

"use strict";

const TOAST_MILLIS = 3000;
const NAME_PATTERN = /^\p{L}[\p{L}' -]*$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function nameError(label, value) {
  const v = value.trim();
  if (v === "") return `${label} is required.`;
  if (v.length > 50) return `${label} must be at most 50 characters.`;
  if (!NAME_PATTERN.test(v)) return `${label} may only use letters, spaces, hyphens and apostrophes.`;
  return null;
}

const validators = {
  firstName: (value) => nameError("First name", value),
  lastName: (value) => nameError("Last name", value),
  email: (value) => {
    const v = value.trim();
    if (v === "") return "Email is required.";
    if (v.length > 254 || !EMAIL_PATTERN.test(v)) return "Enter an email like name@example.com.";
    return null;
  },
  address: (value) => {
    const v = value.trim();
    if (v === "") return "Address is required.";
    if (v.length < 5) return "Address must be at least 5 characters.";
    if (v.length > 200) return "Address must be at most 200 characters.";
    return null;
  },
};

const FIELDS = Object.keys(validators);
const form = document.getElementById("onboarding");
const success = document.getElementById("success");
const toasts = document.getElementById("toasts");
let submissions = 0;

const input = (name) => document.getElementById(name);

/** Validate one field and show or hide its error. Returns true if valid. */
function check(name) {
  const el = input(name);
  const error = el.dataset.touched === "true" ? validators[name](el.value) : null;
  const errorEl = document.getElementById(`${name}-error`);
  errorEl.textContent = error ?? "";
  errorEl.hidden = error === null;
  el.setAttribute("aria-invalid", String(error !== null));
  return validators[name](el.value) === null;
}

function touch(name) {
  input(name).dataset.touched = "true";
  check(name);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.toastId = String(submissions);
  toast.textContent = message;
  toasts.appendChild(toast);
  // The countdown starts when the toast appears, so every toast goes away.
  setTimeout(() => toast.remove(), TOAST_MILLIS);
}

function showSuccess(values) {
  document.getElementById("success-title").textContent =
    `Welcome aboard, ${values.firstName} ${values.lastName}!`;
  for (const name of FIELDS) {
    success.querySelector(`[data-field="${name}"]`).textContent = values[name];
  }
  success.dataset.submission = String(submissions);
  success.hidden = false;
}

function resetForm() {
  form.reset();
  for (const name of FIELDS) {
    delete input(name).dataset.touched;
    check(name);
  }
}

for (const name of FIELDS) {
  input(name).addEventListener("input", () => {
    success.hidden = true;
    touch(name);
  });
  input(name).addEventListener("blur", () => touch(name));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  FIELDS.forEach(touch);
  const invalid = FIELDS.filter((name) => !check(name));
  if (invalid.length > 0) {
    success.hidden = true;
    input(invalid[0]).focus();
    return;
  }
  const values = Object.fromEntries(FIELDS.map((name) => [name, input(name).value.trim()]));
  submissions += 1;
  showSuccess(values);
  showToast(`Account created for ${values.email}`);
  resetForm();
});
