import * as bootstrap from 'bootstrap';
import { db, storage } from './firebase-client.js';
import { collection, doc, getDoc } from 'firebase/firestore';
import { ref, listAll, getDownloadURL, getMetadata, deleteObject } from 'firebase/storage';

document.addEventListener('DOMContentLoaded', () => {
    const receiptsTableBody = document.getElementById('receiptsTableBody');
    const imageModalEl = document.getElementById('imageModal');
    let imageModal = null;
    if (imageModalEl) {
        imageModal = new bootstrap.Modal(imageModalEl);
    }
    const modalImage = document.getElementById('modalImage');

    const userRoleId = localStorage.getItem('userRoleId');
    const isSpectator = userRoleId === '6' || userRoleId === 6;

    const actionHeader = document.getElementById('actionColumnHeader');
    if (actionHeader) {
        actionHeader.style.display = isSpectator ? 'none' : '';
    }

    async function loadReceipts() {
        if (!receiptsTableBody) return;
        receiptsTableBody.innerHTML = `<tr><td colspan="${isSpectator ? 3 : 4}" class="text-center py-4">Loading receipts...</td></tr>`;
        try {
            const usersRef = ref(storage, 'Users');
            const res = await listAll(usersRef);
            const userFolders = res.prefixes;

            if (userFolders.length === 0) {
                receiptsTableBody.innerHTML = `<tr><td colspan="${isSpectator ? 3 : 4}" class="text-center py-4 text-muted">No receipts found.</td></tr>`;
                return;
            }

            let html = '';
            for (const folderRef of userFolders) {
                const userId = folderRef.name;
                
                // Fetch User Name
                let userName = 'Unknown User';
                try {
                    const userDocRef = doc(db, 'users', userId);
                    const userDoc = await getDoc(userDocRef);
                    if (userDoc.exists()) {
                        const data = userDoc.data();
                        userName = data.name || data.displayName || (data.firstName ? data.firstName + ' ' + (data.lastName || '') : '') || userId;
                    } else {
                        userName = userId;
                    }
                } catch (e) {
                    console.error('Error fetching user', userId, e);
                }

                // Fetch images in folder
                const folderRes = await listAll(folderRef);
                for (const itemRef of folderRes.items) {
                    if (itemRef.name !== 'user_avatar.jpg') {
                        try {
                            const [url, metadata] = await Promise.all([
                                getDownloadURL(itemRef),
                                getMetadata(itemRef)
                            ]);
                            const uploadTime = new Date(metadata.timeCreated).toLocaleString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true
                            });
                            const actionCell = isSpectator ? '' : `
                                <td class="align-middle">
                                    <button class="btn btn-sm btn-outline-danger delete-receipt-btn" data-path="${itemRef.fullPath}">
                                        <i class="ti ti-trash"></i>
                                    </button>
                                </td>
                            `;
                            html += `
                                <tr>
                                    <td class="align-middle">${userName}</td>
                                    <td class="align-middle">${uploadTime}</td>
                                    <td class="align-middle">
                                        <img src="${url}" alt="Receipt" class="img-thumbnail" style="width: 100px; height: 70px; object-fit: cover; cursor: pointer;" data-url="${url}">
                                    </td>
                                    ${actionCell}
                                </tr>
                            `;
                        } catch (err) {
                            console.error('Error fetching image URL', err);
                        }
                    }
                }
            }

            if (html === '') {
                receiptsTableBody.innerHTML = `<tr><td colspan="${isSpectator ? 3 : 4}" class="text-center py-4 text-muted">No receipts found.</td></tr>`;
            } else {
                receiptsTableBody.innerHTML = html;
            }
        } catch (error) {
            console.error('Error loading receipts:', error);
            receiptsTableBody.innerHTML = `<tr><td colspan="${isSpectator ? 3 : 4}" class="text-center py-4 text-danger">Error loading receipts.</td></tr>`;
        }
    }

    if (receiptsTableBody) {
        let receiptToDeletePath = null;
    const deleteModalElement = document.getElementById('deleteReceiptModal');
    let deleteModal;
    if (deleteModalElement) {
        deleteModal = new bootstrap.Modal(deleteModalElement);
    }
    const confirmDeleteBtn = document.getElementById('confirmDeleteReceiptBtn');

    receiptsTableBody.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.delete-receipt-btn');
        if (deleteBtn) {
            receiptToDeletePath = deleteBtn.getAttribute('data-path');
            if (deleteModal) deleteModal.show();
            return;
        }

        if (e.target.tagName === 'IMG') {
            const url = e.target.getAttribute('data-url');
            if (url) {
                const modalImage = document.getElementById('modalImage');
                if (modalImage) {
                    modalImage.src = url;
                    const imageModal = new bootstrap.Modal(document.getElementById('imageModal'));
                    imageModal.show();
                }
            }
        }
    });

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (!receiptToDeletePath) return;
            
            try {
                confirmDeleteBtn.disabled = true;
                confirmDeleteBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Deleting...';
                
                const itemRef = ref(storage, receiptToDeletePath);
                await deleteObject(itemRef);
                
                if (deleteModal) deleteModal.hide();
                await loadReceipts(); // reload receipts list
            } catch (error) {
                console.error("Error deleting receipt:", error);
                if (error.code === 'storage/unauthorized') {
                    alert("Permission denied. Your Firebase Storage security rules currently do not allow deletions.");
                } else {
                    alert("Failed to delete receipt: " + error.message);
                }
            } finally {
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.innerHTML = 'Delete';
                receiptToDeletePath = null;
            }
        });
    }
    }

    loadReceipts();
});
