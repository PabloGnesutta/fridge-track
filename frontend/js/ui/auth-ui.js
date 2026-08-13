import {
  $, $button, $form, $getInner, $queryOne, $queryOneInput, display, undisplay, makeKeyboardActivatable,
} from "../lib/dom.js";
import { showErrorToast } from "../lib/toast.js";
import { apiLogin, apiSignup } from "../api-caller/apiCaller.js";
import { afterLogin } from "../appBoot.js";


const authForm = $form('authForm');
const formTitleText = $getInner(authForm, '.form-title-text');
const nameField = $('authNameField');
const emailInput = $queryOneInput('#authForm input[name="authEmail"]');
const passwordInput = $queryOneInput('#authForm input[name="authPassword"]');
const nameInput = $queryOneInput('#authForm input[name="authName"]');
const modeToggle = $('authModeToggle');
const submitContainer = $queryOne('#authForm .submit');

/** @type {'login'|'signup'} */
let mode = 'login';

// Intercept native form submission (e.g. pressing Enter in a field) so it
// doesn't navigate the browser away with the field as a GET query string.
authForm.addEventListener('submit', submitAuthForm);
modeToggle.addEventListener('click', toggleMode);
makeKeyboardActivatable(modeToggle);

function initAuthUi() {
  $button({
    label: 'Ingresar',
    listener: { fn: submitAuthForm },
    appendTo: submitContainer,
  });
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

  if (!result.data) { return showErrorToast(result.error || 'No se pudo iniciar sesión'); }

  authForm.reset();
  await afterLogin();
}

export { initAuthUi };
