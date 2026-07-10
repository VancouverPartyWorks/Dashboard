import * as bootstrap from 'bootstrap';
import { db, auth, firebaseConfig } from './firebase-client.js';
import { collection, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { onAuthStateChanged, getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { initializeApp } from 'firebase/app';

document.addEventListener('DOMContentLoaded', () => {
    const usersTableBody = document.getElementById('usersTableBody');
    const addUserForm = document.getElementById('addUserForm');
    const addUserBtn = document.getElementById('addUserBtn');
    
    const userRoleSelect = document.getElementById('userRole');
    const emailFieldContainer = document.getElementById('emailFieldContainer');
    const phoneFieldContainer = document.getElementById('phoneFieldContainer');
    const userEmailInput = document.getElementById('userEmail');
    const userPhoneInput = document.getElementById('userPhone');

    let availableRoles = [];
    let currentUserRoleId = null;
    let currentUserRoleName = '';

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
        if (!userRoleSelect) return;
        userRoleSelect.innerHTML = '<option value="" disabled selected>Select a role...</option>';
        
        let rolesToShow = availableRoles;
        if (currentUserRoleName.toLowerCase() !== 'super admin') {
            rolesToShow = availableRoles.filter(r => 
                r.name.toLowerCase().includes('staff') || 
                r.name.toLowerCase().includes('lead')
            );
        }
        
        rolesToShow.forEach(role => {
            const option = document.createElement('option');
            option.value = role.id; 
            option.dataset.name = role.name;
            option.textContent = role.name;
            userRoleSelect.appendChild(option);
        });
    }

    if (userRoleSelect) {
        userRoleSelect.addEventListener('change', (e) => {
            const selectedRoleId = parseInt(e.target.value, 10);
            if (selectedRoleId === 1 || selectedRoleId === 2 || selectedRoleId === 3) {
                emailFieldContainer.style.display = 'block';
                userEmailInput.required = true;
                userEmailInput.disabled = false;
                phoneFieldContainer.style.display = 'none';
                userPhoneInput.required = false;
                userPhoneInput.disabled = true;
            } else {
                emailFieldContainer.style.display = 'none';
                userEmailInput.required = false;
                userEmailInput.disabled = true;
                phoneFieldContainer.style.display = 'block';
                userPhoneInput.required = true;
                userPhoneInput.disabled = false;
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

                    const isSuperAdmin = currentUserRoleName.toLowerCase() === 'super admin';
                    const isHr = currentUserRoleName.toLowerCase() === 'hr';
                    
                    if (isSuperAdmin || isHr) {
                        if (addUserBtn) addUserBtn.classList.remove('d-none');
                    }
                    
                    populateRolesDropdown();
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
        if (combined.length === 0) {
            usersTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No users found.</td></tr>`;
            return;
        }

        combined.forEach(user => {
            const contactInfo = user.email || user.phoneNumber || 'N/A';
            const roleIdForStatus = user.roleId;
            const activeStatusDisplay = (roleIdForStatus === 1 || roleIdForStatus === 2 || roleIdForStatus === 3) ? 'N/A' : (user.activeStatus || 'onDuty');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.displayName || 'N/A'}</td>
                <td>${contactInfo}</td>
                <td>${user.displayRole}</td>
                <td>${activeStatusDisplay}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-secondary edit-user-btn"
                        data-id="${user.id}"
                        data-source="${user.source}"
                        data-name="${user.displayName || ''}"
                        data-phone="${user.phoneNumber || ''}"
                        data-role="${user.displayRole}"
                        data-status="${activeStatusDisplay}">
                        <i class="ti ti-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger delete-user-btn ms-1"
                        data-id="${user.id}"
                        data-source="${user.source}">
                        <i class="ti ti-trash"></i>
                    </button>
                </td>
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
            const displayName = document.getElementById('userName').value;
            const phoneNumber = document.getElementById('userPhone').value;
            const email = document.getElementById('userEmail').value;
            const roleSelect = document.getElementById('userRole');
            const roleId = parseInt(roleSelect.value, 10);

            if (!db) {
                alert("Firebase not configured. Cannot add user.");
                return;
            }

            try {
                let newUserData = {
                    displayName,
                    roleId: roleId,
                    activeStatus: 'onDuty',
                    createdAt: serverTimestamp()
                };
                
                if (roleId === 1 || roleId === 2 || roleId === 3) {
                    newUserData.email = email;
                    
                    const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp" + Date.now());
                    const secondaryAuth = getAuth(secondaryApp);
                    await createUserWithEmailAndPassword(secondaryAuth, email, "PartyWorks2026!");
                    await secondaryAuth.signOut();
                } else {
                    newUserData.phoneNumber = phoneNumber;
                    console.info("Note: Phone number authentication users require OTP verification or Admin SDK to be created in Firebase Auth. Adding to Firestore only.");
                }

                await addDoc(collection(db, "users"), newUserData);
                
                const modal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
                if (modal) modal.hide();
                
                addUserForm.reset();
            } catch (error) {
                console.error("Error adding user: ", error);
                alert("Failed to add user. " + (error.message || ''));
            }
        });
    }

    let userToDeleteId = null;
    let userToDeleteSource = 'users';

    usersTableBody.addEventListener('click', async (e) => {
        const deleteBtn = e.target.closest('.delete-user-btn');
        if (deleteBtn) {
            userToDeleteId = deleteBtn.dataset.id;
            userToDeleteSource = deleteBtn.dataset.source || 'users';
            const modal = new bootstrap.Modal(document.getElementById('deleteUserModal'));
            modal.show();
            return;
        }

        const btn = e.target.closest('.edit-user-btn');
        if (btn) {
            document.getElementById('editUserId').value = btn.dataset.id;
            document.getElementById('editUserId').dataset.source = btn.dataset.source;
            document.getElementById('editUserName').value = btn.dataset.name;
            document.getElementById('editUserPhone').value = btn.dataset.phone;
            
            const roleSelect = document.getElementById('editUserRole');
            if (!Array.from(roleSelect.options).some(opt => opt.value === btn.dataset.role)) {
                 roleSelect.add(new Option(btn.dataset.role, btn.dataset.role));
            }
            roleSelect.value = btn.dataset.role;

            const statusSelect = document.getElementById('editUserStatus');
            if (!Array.from(statusSelect.options).some(opt => opt.value === btn.dataset.status)) {
                 statusSelect.add(new Option(btn.dataset.status, btn.dataset.status));
            }
            statusSelect.value = btn.dataset.status;

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
            const roleName = document.getElementById('editUserRole').value;
            const activeStatus = document.getElementById('editUserStatus').value;

            try {
                const currentRoleObj = availableRoles.find(r => r.name === roleName);
                const roleId = currentRoleObj ? currentRoleObj.id : null;

                const updateData = {
                    displayName,
                    activeStatus,
                    updatedAt: serverTimestamp()
                };
                if (roleId) {
                    updateData.roleId = roleId;
                } else {
                    updateData.role = roleName; // fallback if somehow not mapped to id
                }
                
                if (phoneNumber) updateData.phoneNumber = phoneNumber;

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
        loadUsers();
    });
});
