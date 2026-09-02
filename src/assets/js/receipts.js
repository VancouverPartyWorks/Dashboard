import * as bootstrap from 'bootstrap';
import { db, storage } from './firebase-client.js';
import { collection, doc, getDoc } from 'firebase/firestore';
import { ref, listAll, getDownloadURL, getMetadata, deleteObject, getBlob } from 'firebase/storage';

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

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function stripExtension(filename) {
        if (!filename) return '';
        const lastDotIndex = filename.lastIndexOf('.');
        if (lastDotIndex > 0) {
            return filename.substring(0, lastDotIndex);
        }
        return filename;
    }

    async function downloadReceipt(path, fileName, btnElement = null, url = null) {
        let originalHtml = '';
        if (btnElement) {
            btnElement.disabled = true;
            originalHtml = btnElement.innerHTML;
            btnElement.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
        }
        try {
            let blob = null;

            // 1. Try fetching via local proxy if on localhost to bypass CORS completely
            if (url) {
                try {
                    let fetchUrl = url;
                    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                        if (fetchUrl.includes('firebasestorage.googleapis.com')) {
                            fetchUrl = fetchUrl.replace('https://firebasestorage.googleapis.com', '/storage-proxy');
                        }
                    }
                    const response = await fetch(fetchUrl);
                    if (response.ok) {
                        blob = await response.blob();
                    }
                } catch (fetchErr) {
                    console.warn('Proxy fetch failed, attempting getBlob fallback:', fetchErr);
                }
            }

            // 2. Try getBlob from Firebase SDK
            if (!blob && path) {
                try {
                    const itemRef = ref(storage, path);
                    blob = await getBlob(itemRef);
                } catch (blobErr) {
                    console.warn('getBlob failed:', blobErr);
                }
            }

            // 3. Try direct fetch
            if (!blob && url) {
                try {
                    const response = await fetch(url);
                    if (response.ok) {
                        blob = await response.blob();
                    }
                } catch (e) {
                    console.warn('Direct fetch failed:', e);
                }
            }

            if (!blob) {
                throw new Error('Could not download file data.');
            }

            // Trigger real PC file download via Blob URL
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = fileName || 'receipt.jpg';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1500);
        } catch (err) {
            console.error('Download to PC failed:', err);
            alert('Failed to download receipt to PC: ' + err.message);
        } finally {
            if (btnElement) {
                btnElement.disabled = false;
                btnElement.innerHTML = originalHtml;
            }
        }
    }

    async function loadReceipts() {
        if (!receiptsTableBody) return;
        receiptsTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">Loading receipts...</td></tr>`;
        try {
            const usersRef = ref(storage, 'Users');
            const res = await listAll(usersRef);
            const userFolders = res.prefixes;

            if (userFolders.length === 0) {
                receiptsTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No receipts found.</td></tr>`;
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
                            const fileName = itemRef.name;
                            const title = stripExtension(fileName);
                            const actionCell = `
                                <td class="align-middle">
                                    <button class="btn btn-sm btn-outline-primary download-receipt-btn ${isSpectator ? '' : 'me-2'}" data-path="${itemRef.fullPath}" data-url="${url}" data-filename="${escapeHtml(fileName)}" title="Download Receipt">
                                        <i class="ti ti-download"></i>
                                    </button>
                                    ${isSpectator ? '' : `
                                    <button class="btn btn-sm btn-outline-danger delete-receipt-btn" data-path="${itemRef.fullPath}" title="Delete Receipt">
                                        <i class="ti ti-trash"></i>
                                    </button>
                                    `}
                                </td>
                            `;
                            html += `
                                <tr>
                                    <td class="align-middle">${escapeHtml(userName)}</td>
                                    <td class="align-middle">${uploadTime}</td>
                                    <td class="align-middle">${escapeHtml(title)}</td>
                                    <td class="align-middle">
                                        <img src="${url}" alt="Receipt" class="img-thumbnail" style="width: 100px; height: 70px; object-fit: cover; cursor: pointer;" data-path="${itemRef.fullPath}" data-url="${url}" data-filename="${escapeHtml(fileName)}" data-title="${escapeHtml(title)}">
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
                receiptsTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No receipts found.</td></tr>`;
            } else {
                receiptsTableBody.innerHTML = html;
            }
        } catch (error) {
            console.error('Error loading receipts:', error);
            receiptsTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger">Error loading receipts.</td></tr>`;
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
            const downloadBtn = e.target.closest('.download-receipt-btn');
            if (downloadBtn) {
                const path = downloadBtn.getAttribute('data-path');
                const url = downloadBtn.getAttribute('data-url');
                const fileName = downloadBtn.getAttribute('data-filename');
                downloadReceipt(path, fileName, downloadBtn, url);
                return;
            }

            const deleteBtn = e.target.closest('.delete-receipt-btn');
            if (deleteBtn) {
                receiptToDeletePath = deleteBtn.getAttribute('data-path');
                if (deleteModal) deleteModal.show();
                return;
            }

            if (e.target.tagName === 'IMG') {
                const path = e.target.getAttribute('data-path');
                const url = e.target.getAttribute('data-url');
                const fileName = e.target.getAttribute('data-filename');
                const title = e.target.getAttribute('data-title');
                if (url) {
                    const modalImage = document.getElementById('modalImage');
                    const modalDownloadBtn = document.getElementById('modalDownloadBtn');
                    const imageModalTitle = document.getElementById('imageModalTitle');

                    if (modalImage) modalImage.src = url;
                    if (modalDownloadBtn) {
                        modalDownloadBtn.setAttribute('data-path', path || '');
                        modalDownloadBtn.setAttribute('data-url', url);
                        modalDownloadBtn.setAttribute('data-filename', fileName || '');
                        modalDownloadBtn.innerHTML = '<i class="ti ti-download me-1"></i> Download';
                        modalDownloadBtn.disabled = false;
                    }
                    if (imageModalTitle) {
                        imageModalTitle.textContent = title || 'Receipt';
                    }

                    if (imageModal) {
                        imageModal.show();
                    } else if (imageModalEl) {
                        const imgModal = new bootstrap.Modal(imageModalEl);
                        imgModal.show();
                    }
                }
            }
        });

        const modalDownloadBtn = document.getElementById('modalDownloadBtn');
        if (modalDownloadBtn) {
            modalDownloadBtn.addEventListener('click', async () => {
                const path = modalDownloadBtn.getAttribute('data-path');
                const url = modalDownloadBtn.getAttribute('data-url');
                const fileName = modalDownloadBtn.getAttribute('data-filename');
                if (path || url) {
                    await downloadReceipt(path, fileName, modalDownloadBtn, url);
                }
            });
        }

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
