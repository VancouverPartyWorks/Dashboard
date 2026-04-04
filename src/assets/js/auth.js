const AUTH_STORAGE_KEY = 'pos_auth_user';
const DUMMY_EMAIL = 'irtiqa@admin.com';
const DUMMY_PASSWORD = 'Admin123';
const PUBLIC_PAGES = ['signin.html', 'signup.html'];

function getCurrentPage() {
  const page = window.location.pathname.split('/').pop();
  return page || 'index.html';
}

function isAuthenticated() {
  return Boolean(localStorage.getItem(AUTH_STORAGE_KEY));
}

function redirectTo(url) {
  window.location.href = url;
}

function applyAuthGuard() {
  const currentPage = getCurrentPage();
  const publicPage = PUBLIC_PAGES.includes(currentPage);
  const authed = isAuthenticated();

  if (!publicPage && !authed) {
    redirectTo('./signin.html');
    return;
  }

  if (currentPage === 'signin.html' && authed) {
    redirectTo('./index.html');
  }
}

function setupSigninForm() {
  const currentPage = getCurrentPage();
  if (currentPage !== 'signin.html') return;

  const form = document.querySelector('form.needs-validation');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('loginError');

  if (!form || !emailInput || !passwordInput) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (email === DUMMY_EMAIL && password === DUMMY_PASSWORD) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ email }));
      redirectTo('./index.html');
      return;
    }

    if (loginError) {
      loginError.classList.remove('d-none');
      loginError.textContent = 'Invalid credentials. Use the provided admin dummy login.';
    }
  });
}

function setupLogoutLinks() {
  if (!isAuthenticated()) return;

  const signinLinks = document.querySelectorAll('a[href="signin.html"]');
  signinLinks.forEach((link) => {
    const navText = link.querySelector('.nav-text');

    if (navText && navText.textContent.trim().toLowerCase() === 'log in') {
      navText.textContent = 'Log out';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        localStorage.removeItem(AUTH_STORAGE_KEY);
        redirectTo('./signin.html');
      });
    }
  });
}

applyAuthGuard();
setupSigninForm();
setupLogoutLinks();