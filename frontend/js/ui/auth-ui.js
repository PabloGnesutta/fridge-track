import {
  $, $button, $form, $getInner, $queryOne, $queryOneInput, display, undisplay, makeKeyboardActivatable,
} from "../lib/dom.js";
import { showErrorToast, showInfoToast } from "../lib/toast.js";
import {
  apiLogin, apiSignup, apiVerifyEmail, apiResendVerification,
} from "../api-caller/apiCaller.js";
import { afterLogin } from "../appBoot.js";
import { setAuthStage } from "../common/state.js";


const authForm = $form('authForm');
const formTitleText = $getInner(authForm, '.form-title-text');
const nameField = $('authNameField');
const emailInput = $queryOneInput('#authForm input[name="authEmail"]');
const passwordInput = $queryOneInput('#authForm input[name="authPassword"]');
const nameInput = $queryOneInput('#authForm input[name="authName"]');
const modeToggle = $('authModeToggle');
const submitContainer = $queryOne('#authForm .submit');

const verifyEmailForm = $form('verifyEmailForm');
const verifyEmailHint = $('verifyEmailHint');
const verifyCodeInput = $queryOneInput('#verifyEmailForm input[name="verifyCode"]');
const verifySubmitContainer = $queryOne('#verifyEmailForm .submit');
const resendCodeBtn = $('resendCodeBtn');
const backToLoginBtn = $('backToLoginBtn');

/** @type {'login'|'signup'} */
let mode = 'login';

// Email pending verification - set right before switching to the
// verifyEmail auth stage, either after a fresh signup or after a login
// attempt that got rejected for being unverified (see submitAuthForm).
/** @type {string} */
let pendingVerificationEmail = '';

// Intercept native form submission (e.g. pressing Enter in a field) so it
// doesn't navigate the browser away with the field as a GET query string.
authForm.addEventListener('submit', submitAuthForm);
modeToggle.addEventListener('click', toggleMode);
makeKeyboardActivatable(modeToggle);

verifyEmailForm.addEventListener('submit', submitVerifyEmailForm);
resendCodeBtn.addEventListener('click', resendVerificationCode);
backToLoginBtn.addEventListener('click', backToLogin);
makeKeyboardActivatable(resendCodeBtn);
makeKeyboardActivatable(backToLoginBtn);

function initAuthUi() {
  $button({
    label: 'Ingresar',
    listener: { fn: submitAuthForm },
    appendTo: submitContainer,
  });
  $button({
    label: 'Confirmar',
    listener: { fn: submitVerifyEmailForm },
    appendTo: verifySubmitContainer,
  });
}

/**
 * @param {string} email
 */
function goToVerifyEmail(email) {
  pendingVerificationEmail = email;
  verifyEmailHint.innerText = `Te enviamos un código a ${email}. Ingresalo para confirmar tu cuenta.`;
  verifyCodeInput.value = '';
  setAuthStage('verifyEmail');
}

function backToLogin() {
  pendingVerificationEmail = '';
  mode = 'login';
  formTitleText.innerText = 'Iniciar Sesión';
  modeToggle.innerText = '¿No tenés cuenta? Creá una';
  undisplay(nameField);
  setAuthStage('login');
}

/**
 * @param {Event} e
 */
async function submitVerifyEmailForm(e) {
  e.preventDefault();
  const code = verifyCodeInput.value.trim();
  if (!code) { return showErrorToast('Ingresá el código que te enviamos'); }

  const result = await apiVerifyEmail(pendingVerificationEmail, code);
  if (!result.data) { return showErrorToast(result.error || 'No se pudo confirmar el email'); }

  pendingVerificationEmail = '';
  verifyEmailForm.reset();
  await afterLogin();
}

async function resendVerificationCode() {
  if (!pendingVerificationEmail) { return; }
  const result = await apiResendVerification(pendingVerificationEmail);
  if (!result.data) { return showErrorToast(result.error || 'No se pudo reenviar el código'); }
  showInfoToast('Te enviamos un nuevo código');
}

/**
 * Handles the one-click link from the verification email
 * (?email=...&code=...) - called once from appBoot.js's bootApp(), before
 * it decides between the login/chooseHome/ready stages, since a fresh
 * signup on this same device has no session yet for isLoggedIn() to find.
 *
 * Returns whether it took over the boot sequence (true either way once the
 * params are present, whether verification actually succeeded or not) so
 * bootApp() knows to stop rather than also running its normal isLoggedIn()
 * check right after.
 * @returns {Promise<boolean>}
 */
async function tryAutoVerifyFromLink() {
  const params = new URLSearchParams(location.search);
  const email = params.get('email');
  const code = params.get('code');
  if (!email || !code) { return false; }

  // Strip the query string immediately, before even attempting the request -
  // a code is single-use, so a reload after landing here (or the browser
  // re-requesting the page) must not silently retry it and show a
  // confusing "código incorrecto" for no user action.
  history.replaceState(null, '', location.pathname);

  const result = await apiVerifyEmail(email, code);
  if (result.data) {
    await afterLogin();
    return true;
  }

  goToVerifyEmail(email);
  showErrorToast(result.error || 'No se pudo confirmar con el enlace, ingresá el código manualmente');
  return true;
}

function toggleMode() {
  mode = mode === 'login' ? 'signup' : 'login';
  if (mode === 'signup') {
    formTitleText.innerText = 'Crear Cuenta';
    modeToggle.innerText = '¿Ya tenés cuenta? Iniciar sesión';
    display(nameField);
  } else {
    formTitleText.innerText = 'Iniciar Sesión';
    modeToggle.innerText = '¿No tenés cuenta? Creá una';
    undisplay(nameField);
  }
}

/**
 * @param {Event} e
 */
async function submitAuthForm(e) {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const name = nameInput.value.trim();

  if (!email || !password) { return showErrorToast('Email y contraseña requeridos'); }

  const result = mode === 'signup'
    ? await apiSignup(email, password, name)
    : await apiLogin(email, password);

  if (!result.data) {
    // A login attempt against an already-existing-but-unverified account
    // fails here with requiresVerification set - route to the code-entry
    // screen (there's already a code waiting, or "Reenviar" gets a new one)
    // instead of just showing red text the user can't act on.
    if (result.requiresVerification) {
      authForm.reset();
      return goToVerifyEmail(email);
    }
    return showErrorToast(result.error || 'No se pudo iniciar sesión');
  }

  authForm.reset();

  if (result.data.requiresVerification) {
    return goToVerifyEmail(result.data.email);
  }

  await afterLogin();
}

export { initAuthUi, tryAutoVerifyFromLink };
