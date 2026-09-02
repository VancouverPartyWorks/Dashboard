import * as bootstrap from 'bootstrap';
import { db, auth, firebaseConfig } from './firebase-client.js';
import { collection, onSnapshot, addDoc, setDoc, serverTimestamp, updateDoc, doc, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { onAuthStateChanged, getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { initializeApp } from 'firebase/app';

document.addEventListener('DOMContentLoaded', () => {
    const usersTableBody = document.getElementById('usersTableBody');
    const addUserForm = document.getElementById('addUserForm');
    const addUserBtn = document.getElementById('addUserBtn');
    
    const userRoleSelect = document.getElementById('userRole');
    const editUserRoleSelect = document.getElementById('editUserRole');
    const emailFieldContainer = document.getElementById('emailFieldContainer');
    const passwordFieldContainer = document.getElementById('passwordFieldContainer');
    const phoneFieldContainer = document.getElementById('phoneFieldContainer');
    const userEmailInput = document.getElementById('userEmail');
    const userPasswordInput = document.getElementById('userPassword');
    const userPhoneInput = document.getElementById('userPhone');
    const toggleUserPasswordBtn = document.getElementById('toggleUserPassword');

    let availableRoles = [];
    let currentUserRoleId = null;
    let currentUserRoleName = '';
    let isSuperAdmin = false;
    let isSuperAdminLocal = false;
    let isHr = false;

    let fetchRolesPromise = null;
    function fetchRoles() {
        if (!db) return Promise.resolve();
        if (!fetchRolesPromise) {
            fetchRolesPromise = getDocs(collection(db, "userRoles")).then(querySnapshot => {
                availableRoles = querySnapshot.docs.map(doc => ({
                    id: doc.data().id,
                    name: doc.data().name
                })).sort((a, b) => a.id - b.id);
            }).catch(error => {
                console.error("Error fetching roles: ", error);
            });
        }
        return fetchRolesPromise;
    }

    function populateRolesDropdown() {
        let rolesToShow = availableRoles;
        if (currentUserRoleName && currentUserRoleName.toLowerCase() !== 'super admin') {
            rolesToShow = availableRoles.filter(r => 
                r.name.toLowerCase().includes('staff') || 
                r.name.toLowerCase().includes('lead')
            );
        }
        
        if (userRoleSelect) {
            userRoleSelect.innerHTML = '<option value="" disabled selected>Select a role...</option>';
            rolesToShow.forEach(role => {
                const option = document.createElement('option');
                option.value = role.id; 
                option.dataset.name = role.name;
                option.textContent = role.name;
                userRoleSelect.appendChild(option);
            });
        }

        if (editUserRoleSelect) {
            editUserRoleSelect.innerHTML = '<option value="" disabled selected>Select a role...</option>';
            rolesToShow.forEach(role => {
                const option = document.createElement('option');
                option.value = role.id;
                option.dataset.name = role.name;
                option.textContent = role.name;
                editUserRoleSelect.appendChild(option);
            });
        }
    }

    if (toggleUserPasswordBtn && userPasswordInput) {
        toggleUserPasswordBtn.addEventListener('click', () => {
            const isPassword = userPasswordInput.type === 'password';
            userPasswordInput.type = isPassword ? 'text' : 'password';
            const icon = toggleUserPasswordBtn.querySelector('i');
            if (icon) {
                icon.classList.remove('ti-eye', 'ti-eye-off');
                icon.classList.add(isPassword ? 'ti-eye-off' : 'ti-eye');
            }
        });
    }

    if (userRoleSelect) {
        userRoleSelect.addEventListener('change', (e) => {
            const selectedRoleId = parseInt(e.target.value, 10);
            if (selectedRoleId === 1 || selectedRoleId === 2 || selectedRoleId === 3 || selectedRoleId === 6) {
                if (emailFieldContainer) emailFieldContainer.style.display = 'block';
                if (userEmailInput) {
                    userEmailInput.required = true;
                    userEmailInput.disabled = false;
                }
                if (passwordFieldContainer) passwordFieldContainer.style.display = 'block';
                if (userPasswordInput) {
                    userPasswordInput.required = true;
                    userPasswordInput.disabled = false;
                }
                if (phoneFieldContainer) phoneFieldContainer.style.display = 'none';
                if (userPhoneInput) {
                    userPhoneInput.required = false;
                    userPhoneInput.disabled = true;
                }
            } else {
                if (emailFieldContainer) emailFieldContainer.style.display = 'none';
                if (userEmailInput) {
                    userEmailInput.required = false;
                    userEmailInput.disabled = true;
                }
                if (passwordFieldContainer) passwordFieldContainer.style.display = 'none';
                if (userPasswordInput) {
                    userPasswordInput.required = false;
                    userPasswordInput.disabled = true;
                }
                if (phoneFieldContainer) phoneFieldContainer.style.display = 'block';
                if (userPhoneInput) {
                    userPhoneInput.required = true;
                    userPhoneInput.disabled = false;
                }
            }
        });
    }

    onAuthStateChanged(auth, async (user) => {
        if (user && db) {
            try {
                const q = query(collection(db, "dashboardUsers"), where("email", "==", user.email));
                const querySnapshot = await getDocs(q);
                if (!querySnapshot.empty) {
                    const userData = querySnapshot.docs[0].data();
                    currentUserRoleId = userData.roleId;
                    
                    await fetchRoles();
                    const currentRole = availableRoles.find(r => r.id === currentUserRoleId);
                    currentUserRoleName = currentRole ? currentRole.name : '';

                    isSuperAdminLocal = currentUserRoleName.toLowerCase() === 'super admin' || currentUserRoleId === 1;
                    isHr = currentUserRoleName.toLowerCase() === 'hr' || currentUserRoleId === 2;
                    isSuperAdmin = isSuperAdminLocal || isHr;
                    
                    const pageSubtitle = document.getElementById('pageSubtitle');
                    const tableTitle = document.getElementById('tableTitle');
                    if (pageSubtitle) {
                        pageSubtitle.textContent = isSuperAdmin ? 'Manage Vancouver Partyworks Users' : 'Vancouver Partyworks Users Directory';
                    }
                    if (tableTitle) {
                        tableTitle.textContent = isSuperAdmin ? 'Users Management' : 'Users Directory';
                    }
                    
                    if (isSuperAdmin || isHr) {
                        if (addUserBtn) addUserBtn.classList.remove('d-none');
                    }
                    
                    populateRolesDropdown();
                    renderUsersTable();
                }
            } catch (error) {
                console.error("Error checking user permissions:", error);
            }
        }
    });

    let allUsers = [];
    let allDashboardUsers = [];
    const searchInput = document.getElementById('searchUserInput');

    function renderUsersTable() {
        const searchTerm = (searchInput ? searchInput.value : '').toLowerCase();
        let combined = [...allUsers, ...allDashboardUsers];

        combined.forEach(user => {
            const currentRoleObj = availableRoles.find(r => r.id === user.roleId || r.name === user.role);
            user.displayRole = currentRoleObj ? currentRoleObj.name : (user.role || 'User');
        });

        if (searchTerm) {
             combined = combined.filter(u => 
                 (u.displayName && u.displayName.toLowerCase().includes(searchTerm)) ||
                 (u.email && u.email.toLowerCase().includes(searchTerm)) ||
                 (u.phoneNumber && u.phoneNumber.toLowerCase().includes(searchTerm)) ||
                 (u.displayRole && u.displayRole.toLowerCase().includes(searchTerm))
             );
        }

        combined.sort((a, b) => {
             const aId = typeof a.roleId === 'number' ? a.roleId : Number.MAX_SAFE_INTEGER;
             const bId = typeof b.roleId === 'number' ? b.roleId : Number.MAX_SAFE_INTEGER;
             return aId - bId;
        });

        usersTableBody.innerHTML = '';

        const actionHeader = document.getElementById('actionColumnHeader');
        if (actionHeader) {
            actionHeader.style.display = isSuperAdmin ? '' : 'none';
        }

        if (combined.length === 0) {
            usersTableBody.innerHTML = `<tr><td colspan="${isSuperAdmin ? 5 : 4}" class="text-center py-4 text-muted">No users found.</td></tr>`;
            return;
        }

        combined.forEach(user => {
            const contactInfo = user.email || user.phoneNumber || 'N/A';
            const roleIdForStatus = user.roleId;
            const activeStatusDisplay = (roleIdForStatus === 1 || roleIdForStatus === 2 || roleIdForStatus === 3 || roleIdForStatus === 6) ? 'N/A' : (user.activeStatus || 'onDuty');

            const currentRoleObj = availableRoles.find(r => r.id === user.roleId || r.name === user.role);
            const targetRoleId = typeof user.roleId === 'number' ? user.roleId : (currentRoleObj ? currentRoleObj.id : null);
            
            const isRestrictedTargetRole = (targetRoleId === 1 || targetRoleId === 2 || targetRoleId === 3);
            const canEditOrDeleteUser = isSuperAdminLocal || (isHr && !isRestrictedTargetRole);

            let actionCell = '';
            if (isSuperAdmin) {
                if (canEditOrDeleteUser) {
                    actionCell = `
                        <td class="text-end">
                            <button class="btn btn-sm btn-outline-secondary edit-user-btn"
                                data-id="${user.id}"
                                data-source="${user.source}"
                                data-name="${user.displayName || ''}"
                                data-phone="${user.phoneNumber || ''}"
                                data-role="${user.displayRole}"
                                data-role-id="${targetRoleId || ''}"
                                data-status="${activeStatusDisplay}">
                                <i class="ti ti-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger delete-user-btn ms-1"
                                data-id="${user.id}"
                                data-source="${user.source}"
                                data-role-id="${targetRoleId || ''}">
                                <i class="ti ti-trash"></i>
                            </button>
                        </td>`;
                } else {
                    actionCell = `<td class="text-end"><span class="text-muted small">Restricted</span></td>`;
                }
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.displayName || 'N/A'}</td>
                <td>${contactInfo}</td>
                <td>${user.displayRole}</td>
                <td>${activeStatusDisplay}</td>
                ${actionCell}
            `;
            usersTableBody.appendChild(tr);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', renderUsersTable);
    }

    function loadUsers() {
        if (!db) {
            console.warn("Firebase not fully configured. Showing demo data for users.");
            return;
        }

        onSnapshot(collection(db, "users"), (querySnapshot) => {
            allUsers = [];
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                data.id = docSnap.id;
                data.source = 'users';
                allUsers.push(data);
            });
            renderUsersTable();
        }, (error) => {
            console.error("Error loading users: ", error);
        });

        onSnapshot(collection(db, "dashboardUsers"), (querySnapshot) => {
            allDashboardUsers = [];
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                data.id = docSnap.id;
                data.source = 'dashboardUsers';
                allDashboardUsers.push(data);
            });
            renderUsersTable();
        }, (error) => {
            console.error("Error loading dashboardUsers: ", error);
        });
    }

    if (addUserForm) {
        addUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const displayName = document.getElementById('userName').value.trim();
            const phoneNumber = document.getElementById('userPhone') ? document.getElementById('userPhone').value.trim() : '';
            const email = document.getElementById('userEmail') ? document.getElementById('userEmail').value.trim() : '';
            const password = document.getElementById('userPassword') ? document.getElementById('userPassword').value : '';
            const roleSelect = document.getElementById('userRole');
            const roleId = parseInt(roleSelect.value, 10);

            if (!db) {
                alert("Firebase not configured. Cannot add user.");
                return;
            }

            const submitBtn = addUserForm.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Save User';

            try {
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';
                }

                if (roleId === 1 || roleId === 2 || roleId === 3 || roleId === 6) {
                    if (!password || password.length < 6) {
                        alert("Password must be at least 6 characters long.");
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = originalBtnText;
                        }
                        return;
                    }

                    // 1. Create user in Firebase Authentication with secondary app instance
                    const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp_" + Date.now());
                    const secondaryAuth = getAuth(secondaryApp);
                    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
                    await secondaryAuth.signOut();

                    const authUid = userCredential.user.uid;

                    // 2. Save user in Firestore dashboardUsers collection with Auth UID as doc ID
                    // Password is NOT saved to Firestore
                    const newUserData = {
                        displayName,
                        email,
                        roleId: roleId,
                        createdAt: serverTimestamp()
                    };

                    await setDoc(doc(db, "dashboardUsers", authUid), newUserData);
                } else {
                    // Mobile / field staff (Lead, Staff)
                    const newUserData = {
                        displayName,
                        phoneNumber,
                        roleId: roleId,
                        activeStatus: 'onDuty',
                        createdAt: serverTimestamp()
                    };

                    await addDoc(collection(db, "users"), newUserData);
                }
                
                const modalEl = document.getElementById('addUserModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
                
                addUserForm.reset();
                if (emailFieldContainer) emailFieldContainer.style.display = 'none';
                if (passwordFieldContainer) passwordFieldContainer.style.display = 'none';
                if (phoneFieldContainer) phoneFieldContainer.style.display = 'none';
            } catch (error) {
                console.error("Error adding user: ", error);
                alert("Failed to add user: " + (error.message || ''));
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                }
            }
        });
    }

    const addUserModalEl = document.getElementById('addUserModal');
    if (addUserModalEl) {
        addUserModalEl.addEventListener('hidden.bs.modal', () => {
            if (addUserForm) addUserForm.reset();
            if (emailFieldContainer) emailFieldContainer.style.display = 'none';
            if (passwordFieldContainer) passwordFieldContainer.style.display = 'none';
            if (phoneFieldContainer) phoneFieldContainer.style.display = 'none';
            if (userPasswordInput) userPasswordInput.type = 'password';
            if (toggleUserPasswordBtn) {
                const icon = toggleUserPasswordBtn.querySelector('i');
                if (icon) {
                    icon.classList.remove('ti-eye-off');
                    icon.classList.add('ti-eye');
                }
            }
        });
    }

    let userToDeleteId = null;
    let userToDeleteSource = 'users';

    usersTableBody.addEventListener('click', async (e) => {
        const deleteBtn = e.target.closest('.delete-user-btn');
        if (deleteBtn) {
            const targetRoleId = parseInt(deleteBtn.dataset.roleId, 10);
            if (isHr && !isSuperAdminLocal && (targetRoleId === 1 || targetRoleId === 2 || targetRoleId === 3)) {
                alert("HR is restricted from deleting users with Super Admin, HR, or Accountant roles.");
                return;
            }
            userToDeleteId = deleteBtn.dataset.id;
            userToDeleteSource = deleteBtn.dataset.source || 'users';
            const modal = new bootstrap.Modal(document.getElementById('deleteUserModal'));
            modal.show();
            return;
        }

        const btn = e.target.closest('.edit-user-btn');
        if (btn) {
            const targetRoleId = parseInt(btn.dataset.roleId, 10);
            if (isHr && !isSuperAdminLocal && (targetRoleId === 1 || targetRoleId === 2 || targetRoleId === 3)) {
                alert("HR is restricted from editing users with Super Admin, HR, or Accountant roles.");
                return;
            }
            document.getElementById('editUserId').value = btn.dataset.id;
            document.getElementById('editUserId').dataset.source = btn.dataset.source;
            document.getElementById('editUserName').value = btn.dataset.name;
            document.getElementById('editUserPhone').value = btn.dataset.phone;
            
            populateRolesDropdown();

            const roleSelect = document.getElementById('editUserRole');
            const targetRoleName = btn.dataset.role;

            let matchedOption = null;
            if (!isNaN(targetRoleId)) {
                matchedOption = Array.from(roleSelect.options).find(opt => parseInt(opt.value, 10) === targetRoleId);
            }
            if (!matchedOption && targetRoleName) {
                matchedOption = Array.from(roleSelect.options).find(opt => opt.textContent.trim().toLowerCase() === targetRoleName.trim().toLowerCase() || opt.value.trim().toLowerCase() === targetRoleName.trim().toLowerCase());
            }

            if (matchedOption) {
                roleSelect.value = matchedOption.value;
            } else if (targetRoleName || !isNaN(targetRoleId)) {
                const optVal = !isNaN(targetRoleId) ? targetRoleId : targetRoleName;
                const optText = targetRoleName || `Role ${targetRoleId}`;
                roleSelect.add(new Option(optText, optVal));
                roleSelect.value = optVal;
            }

            const statusSelect = document.getElementById('editUserStatus');
            const currentStatus = btn.dataset.status || 'onDuty';
            const matchedStatusOpt = Array.from(statusSelect.options).find(opt => opt.value.toLowerCase() === currentStatus.toLowerCase() || opt.textContent.trim().toLowerCase() === currentStatus.trim().toLowerCase());
            if (matchedStatusOpt) {
                statusSelect.value = matchedStatusOpt.value;
            } else {
                if (!Array.from(statusSelect.options).some(opt => opt.value === currentStatus)) {
                    statusSelect.add(new Option(currentStatus, currentStatus));
                }
                statusSelect.value = currentStatus;
            }

            const modal = new bootstrap.Modal(document.getElementById('editUserModal'));
            modal.show();
        }
    });

    const editUserForm = document.getElementById('editUserForm');
    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editUserId').value;
            const source = document.getElementById('editUserId').dataset.source || 'users';
            const displayName = document.getElementById('editUserName').value;
            const phoneNumber = document.getElementById('editUserPhone').value;
            const editRoleSelect = document.getElementById('editUserRole');
            const selectedVal = editRoleSelect.value;
            const parsedRoleId = parseInt(selectedVal, 10);
            const activeStatus = document.getElementById('editUserStatus').value;

            const targetUser = [...allUsers, ...allDashboardUsers].find(u => u.id === id);
            const targetRoleObj = targetUser ? availableRoles.find(r => r.id === targetUser.roleId || r.name === targetUser.role) : null;
            const targetRoleId = targetUser ? (typeof targetUser.roleId === 'number' ? targetUser.roleId : (targetRoleObj ? targetRoleObj.id : null)) : null;

            let roleObj = null;
            if (!isNaN(parsedRoleId)) {
                roleObj = availableRoles.find(r => r.id === parsedRoleId);
            }
            if (!roleObj) {
                roleObj = availableRoles.find(r => r.name.toLowerCase() === selectedVal.toLowerCase());
            }

            const roleId = roleObj ? roleObj.id : (!isNaN(parsedRoleId) ? parsedRoleId : null);
            const roleName = roleObj ? roleObj.name : (editRoleSelect.options[editRoleSelect.selectedIndex]?.textContent || selectedVal);

            if (isHr && !isSuperAdminLocal) {
                if (targetRoleId === 1 || targetRoleId === 2 || targetRoleId === 3) {
                    alert("HR is restricted from editing users with Super Admin, HR, or Accountant roles.");
                    return;
                }
                if (roleId === 1 || roleId === 2 || roleId === 3) {
                    alert("HR is restricted from assigning Super Admin, HR, or Accountant roles.");
                    return;
                }
            }

            try {
                const updateData = {
                    displayName,
                    activeStatus,
                    updatedAt: serverTimestamp()
                };
                if (roleId !== null && !isNaN(roleId)) {
                    updateData.roleId = roleId;
                }
                if (roleName) {
                    updateData.role = roleName;
                }
                
                if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;

                await updateDoc(doc(db, source, id), updateData);
                
                const modalEl = document.getElementById('editUserModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            } catch (error) {
                console.error("Error updating user: ", error);
                alert("Failed to update user.");
            }
        });
    }

    const confirmDeleteBtn = document.getElementById('confirmDeleteUserBtn');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (!userToDeleteId) return;
            const targetUser = [...allUsers, ...allDashboardUsers].find(u => u.id === userToDeleteId);
            const targetRoleObj = targetUser ? availableRoles.find(r => r.id === targetUser.roleId || r.name === targetUser.role) : null;
            const targetRoleId = targetUser ? (typeof targetUser.roleId === 'number' ? targetUser.roleId : (targetRoleObj ? targetRoleObj.id : null)) : null;

            if (isHr && !isSuperAdminLocal && (targetRoleId === 1 || targetRoleId === 2 || targetRoleId === 3)) {
                alert("HR is restricted from deleting users with Super Admin, HR, or Accountant roles.");
                return;
            }

            try {
                await deleteDoc(doc(db, userToDeleteSource, userToDeleteId));
                
                const modalEl = document.getElementById('deleteUserModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
                
                userToDeleteId = null;
            } catch (error) {
                console.error("Error deleting user:", error);
                alert("Failed to delete user.");
            }
        });
    }

    fetchRoles().then(() => {
        populateRolesDropdown();
        loadUsers();
    });
});
