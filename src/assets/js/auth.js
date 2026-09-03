import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Modal } from 'bootstrap';
import { auth, db } from './firebase-client';

const PUBLIC_PAGES = ['signin.html'];

function getCurrentPage() {
  const page = window.location.pathname.split('/').pop();
  return page || 'index.html';
}

function redirectTo(url) {
  window.location.href = url;
}

function getOrCreateLogoutConfirmModal() {
  const existing = document.getElementById('logoutConfirmModal');
  if (existing) return existing;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal fade" id="logoutConfirmModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Confirm Logout</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            Are you sure you want to log out?
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-role="cancel">Cancel</button>
            <button type="button" class="btn btn-primary" data-role="confirm">Log out</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const modalEl = wrapper.firstElementChild;
  if (modalEl) {
    document.body.appendChild(modalEl);
  }

  return modalEl;
}

function confirmLogoutWithModal() {
  return new Promise((resolve) => {
    const modalEl = getOrCreateLogoutConfirmModal();
    if (!modalEl) {
      resolve(false);
      return;
    }

    const modal = Modal.getOrCreateInstance(modalEl);
    const confirmBtn = modalEl.querySelector('[data-role="confirm"]');
    const cancelBtn = modalEl.querySelector('[data-role="cancel"]');

    let hasResolved = false;
    const finish = (value) => {
      if (hasResolved) return;
      hasResolved = true;

      confirmBtn?.removeEventListener('click', onConfirm);
      cancelBtn?.removeEventListener('click', onCancel);
      modalEl.removeEventListener('hidden.bs.modal', onHidden);
      resolve(value);
    };

    const onConfirm = () => {
      finish(true);
      modal.hide();
    };

    const onCancel = () => {
      finish(false);
      modal.hide();
    };

    const onHidden = () => finish(false);

    confirmBtn?.addEventListener('click', onConfirm);
    cancelBtn?.addEventListener('click', onCancel);
    modalEl.addEventListener('hidden.bs.modal', onHidden);

    modal.show();
  });
}

function applyRolePermissions(userData) {
  const roleId = userData.roleId;
  localStorage.setItem('userRoleId', roleId);
  const isSpectator = roleId === 6 || (userData.role && userData.role.toLowerCase() === 'spectator');
  const isRestricted = (roleId === 2 || roleId === 3) && !isSpectator;
  
  if (isRestricted) {
    // Hide sidebar links
    const sidebarLinks = document.querySelectorAll('a[href="resources.html"]');
    sidebarLinks.forEach(link => {
      const li = link.closest('li');
      if (li) {
        li.style.display = 'none';
        li.classList.add('d-none');
      }
    });

    // Hide dashboard card if present
    const dashboardCardCol = document.getElementById('resourcesCardCol');
    if (dashboardCardCol) {
      dashboardCardCol.style.display = 'none';
      dashboardCardCol.classList.add('d-none');
    }
  } else {
    // Show sidebar links
    const sidebarLinks = document.querySelectorAll('a[href="resources.html"]');
    sidebarLinks.forEach(link => {
      const li = link.closest('li');
      if (li) {
        li.style.display = '';
        li.classList.remove('d-none');
      }
    });

    // Show dashboard card if present
    const dashboardCardCol = document.getElementById('resourcesCardCol');
    if (dashboardCardCol) {
      dashboardCardCol.style.display = '';
      dashboardCardCol.classList.remove('d-none');
    }
  }

  // Shifts & Timesheet page visibility
  const shiftsNavItem = document.getElementById('shiftsNavItem');
  const shiftsCardCol = document.getElementById('shiftsCardCol');
  const timesheetNavItem = document.getElementById('timesheetNavItem');
  const timesheetCardCol = document.getElementById('timesheetCardCol');
  const receiptsNavItem = document.getElementById('receiptsNavItem');
  const receiptsCardCol = document.getElementById('receiptsCardCol');
  
  const isAccountant = (userData.role && (userData.role.toLowerCase() === 'accountant' || userData.role.toLowerCase() === 'accounts')) || roleId === 3;
  const isSuperAdmin = roleId === 1 || (userData.role && userData.role.toLowerCase() === 'super admin');
  const isHr = roleId === 2 || (userData.role && userData.role.toLowerCase() === 'hr');
  const canAccessEvents = isSuperAdmin || isHr || isSpectator;

  const eventsNavItem = document.getElementById('eventsNavItem');
  const eventsCardCol = document.getElementById('eventsCardCol');

  if (eventsNavItem) {
    if (canAccessEvents) {
      eventsNavItem.classList.remove('d-none');
      eventsNavItem.style.display = '';
    } else {
      eventsNavItem.classList.add('d-none');
      eventsNavItem.style.display = 'none';
    }
  }

  if (eventsCardCol) {
    if (canAccessEvents) {
      eventsCardCol.classList.remove('d-none');
      eventsCardCol.style.display = '';
    } else {
      eventsCardCol.classList.add('d-none');
      eventsCardCol.style.display = 'none';
    }
  }

  if (shiftsNavItem) {
    if (isAccountant) {
      shiftsNavItem.classList.add('d-none');
      shiftsNavItem.style.display = 'none';
    } else {
      shiftsNavItem.classList.remove('d-none');
      shiftsNavItem.style.display = '';
    }
  }

  if (shiftsCardCol) {
    if (isAccountant) {
      shiftsCardCol.classList.add('d-none');
      shiftsCardCol.style.display = 'none';
    } else {
      shiftsCardCol.classList.remove('d-none');
      shiftsCardCol.style.display = '';
    }
  }

  if (timesheetNavItem) {
    if (isAccountant || isSuperAdmin) {
      timesheetNavItem.classList.remove('d-none');
      timesheetNavItem.style.display = '';
    } else {
      timesheetNavItem.classList.add('d-none');
      timesheetNavItem.style.display = 'none';
    }
  }

  if (timesheetCardCol) {
    if (isAccountant || isSuperAdmin) {
      timesheetCardCol.classList.remove('d-none');
      timesheetCardCol.style.display = '';
    } else {
      timesheetCardCol.classList.add('d-none');
      timesheetCardCol.style.display = 'none';
    }
  }
  
  if (receiptsNavItem) {
    if (isAccountant || isSuperAdmin) {
      receiptsNavItem.classList.remove('d-none');
      receiptsNavItem.style.display = '';
    } else {
      receiptsNavItem.classList.add('d-none');
      receiptsNavItem.style.display = 'none';
    }
  }

  if (receiptsCardCol) {
    if (isAccountant || isSuperAdmin) {
      receiptsCardCol.classList.remove('d-none');
      receiptsCardCol.style.display = '';
    } else {
      receiptsCardCol.classList.add('d-none');
      receiptsCardCol.style.display = 'none';
    }
  }

  // Prevent direct access
  const currentPage = getCurrentPage();
  if (isRestricted && currentPage === 'resources.html') {
    redirectTo('./index.html');
  }
  if (!isAccountant && !isSuperAdmin && currentPage === 'receipts.html') {
    redirectTo('./index.html');
  }
  if (isAccountant && currentPage === 'shifts.html') {
    redirectTo('./timesheet.html');
  }
  if (!isAccountant && !isSuperAdmin && currentPage === 'timesheet.html') {
    redirectTo('./index.html');
  }
  if (!canAccessEvents && currentPage === 'events.html') {
    redirectTo('./index.html');
  }
}

function updateUserProfileUI(userData) {
  const nameEl = document.getElementById('userProfileName');
  const roleEl = document.getElementById('userProfileRole');
  const avatarDropdownEl = document.getElementById('userAvatarDropdown');
  const avatarMenuEl = document.getElementById('userAvatarMenu');

  if (nameEl) nameEl.textContent = userData.displayName || 'User';
  
  let roleText = 'User';
  let avatarNum = 1;
  if (userData.roleId === 1) {
    roleText = 'Super Admin';
    avatarNum = 1;
  } else if (userData.roleId === 2) {
    roleText = 'HR';
    avatarNum = 2;
  } else if (userData.roleId === 3) {
    roleText = 'Accountant';
    avatarNum = 3;
  } else if (userData.roleId === 6 || (userData.role && userData.role.toLowerCase() === 'spectator')) {
    roleText = 'Spectator';
    avatarNum = 4;
  }
  
  if (roleEl) roleEl.textContent = roleText;
  
  const avatarSrc = `./assets/images/avatar/avatar-${avatarNum}.jpg`;
  if (avatarDropdownEl) avatarDropdownEl.src = avatarSrc;
  if (avatarMenuEl) avatarMenuEl.src = avatarSrc;
}

function applyAuthGuard() {
  onAuthStateChanged(auth, async (user) => {
    const currentPage = getCurrentPage();
    const isPublicPage = PUBLIC_PAGES.includes(currentPage);

    if (!isPublicPage && !user) {
      redirectTo('./signin.html');
      return;
    }

    if (!isPublicPage && user) {
      try {
        const q = query(collection(db, "dashboardUsers"), where("email", "==", user.email));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
          await signOut(auth);
          redirectTo('./signin.html');
          return;
        }
        const userData = querySnapshot.docs[0].data();
        applyRolePermissions(userData);
        updateUserProfileUI(userData);
      } catch (error) {
        console.error("Error checking user access:", error);
        await signOut(auth);
        redirectTo('./signin.html');
      }
    }

    if (isPublicPage && user) {
      try {
        const q = query(collection(db, "dashboardUsers"), where("email", "==", user.email));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          redirectTo('./index.html');
        } else {
          await signOut(auth);
        }
      } catch (error) {
        console.error("Error checking user access:", error);
        await signOut(auth);
      }
    }
  });
}

function getAuthErrorMessage(errorCode) {
  const errorMap = {
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/missing-password': 'Please enter your password.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/email-already-in-use': 'This email is already registered. Please sign in instead.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/network-request-failed': 'Network error. Please check your internet and try again.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/invalid-phone-number': 'Please enter a valid phone number including the country code.',
    'auth/missing-phone-number': 'Please enter your phone number.',
    'auth/invalid-verification-code': 'Invalid OTP code. Please check and try again.',
    'auth/missing-verification-code': 'Please enter the OTP code.',
    'auth/quota-exceeded': 'SMS quota exceeded. Please try again later.',
  };

  return errorMap[errorCode] || 'Something went wrong. Please try again.';
}

function setMessage(element, message, type = 'danger') {
  if (!element) return;

  element.classList.remove('d-none', 'alert-danger', 'alert-success');
  element.classList.add(type === 'success' ? 'alert-success' : 'alert-danger');
  element.textContent = message;
}

function clearMessage(element) {
  if (!element) return;
  element.classList.add('d-none');
  element.textContent = '';
}

function setupPasswordVisibilityToggles() {
  const toggleButtons = document.querySelectorAll('[data-toggle-password]');

  toggleButtons.forEach((button) => {
    if (button.dataset.toggleBound === 'true') return;

    const targetId = button.dataset.togglePassword;
    const input = targetId ? document.getElementById(targetId) : null;
    if (!input) return;

    const icon = button.querySelector('i');

    button.dataset.toggleBound = 'true';
    button.addEventListener('click', () => {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';

      const shouldShow = input.type === 'password';
      button.setAttribute(
        'aria-label',
        `${shouldShow ? 'Show' : 'Hide'} ${targetId === 'confirmPassword' ? 'confirm password' : 'password'}`
      );
      button.setAttribute('aria-pressed', String(!shouldShow));

      if (icon) {
        icon.classList.remove('ti-eye', 'ti-eye-off');
        icon.classList.add(shouldShow ? 'ti-eye' : 'ti-eye-off');
      }
    });
  });
}

function setupSigninForm() {
  const currentPage = getCurrentPage();
  if (currentPage !== 'signin.html') return;

  const form = document.getElementById('emailAuthForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const signInButton = document.getElementById('signInButton');
  const loginError = document.getElementById('loginError');

  if (!form || !emailInput || !passwordInput) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    clearMessage(loginError);

    try {
      signInButton.setAttribute('disabled', 'true');
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      const q = query(collection(db, "dashboardUsers"), where("email", "==", userCredential.user.email));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        redirectTo('./index.html');
      } else {
        await signOut(auth);
        setMessage(loginError, 'Access denied. You must have access to login.');
      }
    } catch (error) {
      console.error("Firebase Auth Error (Signin):", error);
      setMessage(loginError, getAuthErrorMessage(error.code));
    } finally {
      signInButton.removeAttribute('disabled');
    }
  });
}



function setupLogoutLinks() {
  onAuthStateChanged(auth, (user) => {
    const signinLinks = document.querySelectorAll('a[href="signin.html"]');
    signinLinks.forEach((link) => {
      const textEl = link.querySelector('.nav-text') || link.querySelector('span');
      if (textEl) {
        textEl.textContent = user ? 'Log out' : 'Log in';
      }
      link.onclick = null;

      if (!user) return;

      link.onclick = async (event) => {
        event.preventDefault();
        const confirmed = await confirmLogoutWithModal();
        if (!confirmed) return;

        localStorage.removeItem('userRoleId');
        await signOut(auth);
        redirectTo('./signin.html');
      };
    });
  });
}

applyAuthGuard();
setupSigninForm();
setupLogoutLinks();
setupPasswordVisibilityToggles();