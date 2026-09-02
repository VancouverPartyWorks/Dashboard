import * as bootstrap from 'bootstrap';
import { db, storage } from './firebase-client.js';
import { ref, listAll, getDownloadURL, getMetadata, uploadBytesResumable, deleteObject } from 'firebase/storage';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';

document.addEventListener('DOMContentLoaded', () => {
    const resourcesTableBody = document.getElementById('resourcesTableBody');
    const tableHead = document.getElementById('tableHead');
    const categoryCards = document.querySelectorAll('.resource-category-card');
    const currentCategoryTitle = document.getElementById('currentCategoryTitle');
    
    const fileInput = document.getElementById('fileInput');
    const uploadFileBtn = document.getElementById('uploadFileBtn');
    const addVideoBtn = document.getElementById('addVideoBtn');
    
    const uploadProgressContainer = document.getElementById('uploadProgressContainer');
    const uploadProgressBar = document.getElementById('uploadProgressBar');
    const uploadFileName = document.getElementById('uploadFileName');
    const uploadProgressText = document.getElementById('uploadProgressText');
    
    const videoForm = document.getElementById('videoForm');
    const videoModalEl = document.getElementById('videoModal');
    let videoModalInstance = null;
    if (videoModalEl) {
        videoModalInstance = new bootstrap.Modal(videoModalEl);
    }
    
    let currentFolder = 'Manuals'; // Default
    const userRoleId = localStorage.getItem('userRoleId');
    const isSpectator = userRoleId === '6' || userRoleId === 6;

    // Set active folder on card click
    categoryCards.forEach(card => {
        card.addEventListener('click', (e) => {
            categoryCards.forEach(c => c.classList.remove('border-primary'));
            const targetCard = e.currentTarget;
            targetCard.classList.add('border-primary');
            
            currentFolder = targetCard.getAttribute('data-folder');
            if (currentCategoryTitle) {
                currentCategoryTitle.textContent = currentFolder;
            }
            loadFiles(currentFolder);
        });
    });

    // Helper: format bytes
    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    let unsubscribeVideos = null;

    async function loadFiles(folder) {
        if (unsubscribeVideos) {
            unsubscribeVideos();
            unsubscribeVideos = null;
        }
        resourcesTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">Loading...</td></tr>`;
        
        if (folder === 'Training Videos') {
            uploadFileBtn.classList.add('d-none');
            if (isSpectator) {
                addVideoBtn.classList.add('d-none');
            } else {
                addVideoBtn.classList.remove('d-none');
            }
            tableHead.innerHTML = `
                <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Description</th>
                    <th scope="col">Video Link</th>
                    ${isSpectator ? '' : '<th scope="col" class="text-end">Action</th>'}
                </tr>
            `;
            await loadVideos();
        } else {
            if (isSpectator) {
                uploadFileBtn.classList.add('d-none');
            } else {
                uploadFileBtn.classList.remove('d-none');
            }
            addVideoBtn.classList.add('d-none');
            tableHead.innerHTML = `
                <tr>
                    <th scope="col">File Name</th>
                    <th scope="col">Type</th>
                    <th scope="col">Size</th>
                    <th scope="col" class="text-end">Action</th>
                </tr>
            `;
            await loadStorageFiles(folder);
        }
    }

    function loadVideos() {
        if (!db) {
            resourcesTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">Firestore not configured.</td></tr>`;
            return;
        }

        unsubscribeVideos = onSnapshot(collection(db, "trainingVideos"), (querySnapshot) => {
            if (currentFolder !== 'Training Videos') return;
            
            if (querySnapshot.empty) {
                resourcesTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">No videos found.</td></tr>`;
                return;
            }

            resourcesTableBody.innerHTML = '';
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const tr = document.createElement('tr');
                const actionCell = isSpectator ? '' : `
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-secondary edit-video-btn me-1" 
                                data-id="${docSnap.id}" 
                                data-title="${data.title || ''}" 
                                data-desc="${data.description || ''}" 
                                data-url="${data.videoUrl || ''}">
                            <i class="ti ti-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger delete-btn" data-type="video" data-path="${docSnap.id}" data-name="${data.title || 'Video'}"><i class="ti ti-trash"></i></button>
                    </td>
                `;
                tr.innerHTML = `
                    <td>${data.title || 'N/A'}</td>
                    <td>${data.description || 'N/A'}</td>
                    <td><a href="${data.videoUrl || '#'}" target="_blank" class="text-primary">Watch</a></td>
                    ${actionCell}
                `;
                resourcesTableBody.appendChild(tr);
            });
            attachDeleteListeners();
            attachEditVideoListeners();
        }, (error) => {
            console.error("Error loading videos: ", error);
            resourcesTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">Error loading videos.</td></tr>`;
        });
    }

    async function loadStorageFiles(folder) {
        if (!storage) {
            resourcesTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">Firebase storage not configured.</td></tr>`;
            return;
        }

        try {
            const listRef = ref(storage, `Resources/${folder}`);
            const res = await listAll(listRef);
            
            if (res.items.length === 0) {
                resourcesTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">No files found in ${folder}.</td></tr>`;
                return;
            }

            resourcesTableBody.innerHTML = '';
            
            for (const itemRef of res.items) {
                const tr = document.createElement('tr');
                const actionContent = isSpectator ? `
                    <a href="#" class="btn btn-sm btn-outline-primary view-btn" target="_blank" data-path="${itemRef.fullPath}">View</a>
                ` : `
                    <a href="#" class="btn btn-sm btn-outline-primary view-btn me-1" target="_blank" data-path="${itemRef.fullPath}">View</a>
                    <button class="btn btn-sm btn-outline-danger delete-btn" data-type="file" data-path="${itemRef.fullPath}" data-name="${itemRef.name}"><i class="ti ti-trash"></i></button>
                `;
                tr.innerHTML = `
                    <td>${itemRef.name}</td>
                    <td class="type-cell">Loading...</td>
                    <td class="size-cell">Loading...</td>
                    <td class="text-end">
                        ${actionContent}
                    </td>
                `;
                resourcesTableBody.appendChild(tr);

                Promise.all([getMetadata(itemRef), getDownloadURL(itemRef)]).then(([metadata, url]) => {
                    tr.querySelector('.type-cell').textContent = metadata.contentType || 'Unknown';
                    tr.querySelector('.size-cell').textContent = formatBytes(metadata.size);
                    tr.querySelector('.view-btn').href = url;
                }).catch(err => {
                    console.error("Error fetching data for", itemRef.name, err);
                    tr.querySelector('.type-cell').textContent = 'Error';
                    tr.querySelector('.size-cell').textContent = 'Error';
                });
            }
            
            attachDeleteListeners();

        } catch (error) {
            console.error("Error loading files: ", error);
            resourcesTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">Error loading files: ${error.message}</td></tr>`;
        }
    }

    // --- Video Logic ---
    if (addVideoBtn) {
        addVideoBtn.addEventListener('click', () => {
            document.getElementById('videoForm').reset();
            document.getElementById('videoForm').classList.remove('was-validated');
            document.getElementById('videoId').value = '';
            document.getElementById('videoModalTitle').textContent = 'Add Video';
            if (videoModalInstance) videoModalInstance.show();
        });
    }

    function attachEditVideoListeners() {
        const editBtns = document.querySelectorAll('.edit-video-btn');
        editBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const button = e.currentTarget;
                document.getElementById('videoForm').reset();
                document.getElementById('videoForm').classList.remove('was-validated');
                
                document.getElementById('videoId').value = button.getAttribute('data-id');
                document.getElementById('videoTitle').value = button.getAttribute('data-title');
                document.getElementById('videoDesc').value = button.getAttribute('data-desc');
                document.getElementById('videoUrl').value = button.getAttribute('data-url');
                
                document.getElementById('videoModalTitle').textContent = 'Edit Video';
                if (videoModalInstance) videoModalInstance.show();
            });
        });
    }

    if (videoForm) {
        videoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Custom YouTube URL validation
            const urlInput = document.getElementById('videoUrl');
            const ytRegex = /^(https?\:\/\/)?(www\.youtube\.com|youtu\.be)\/.+$/;
            if (!ytRegex.test(urlInput.value)) {
                urlInput.setCustomValidity('Invalid YouTube URL');
            } else {
                urlInput.setCustomValidity('');
            }
            
            if (!videoForm.checkValidity()) {
                e.stopPropagation();
                videoForm.classList.add('was-validated');
                return;
            }
            
            const idVal = document.getElementById('videoId').value;
            const titleVal = document.getElementById('videoTitle').value;
            const descVal = document.getElementById('videoDesc').value;
            const urlVal = document.getElementById('videoUrl').value;
            
            const saveBtn = document.getElementById('saveVideoBtn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            
            try {
                let docRef;
                if (idVal) {
                    docRef = doc(db, 'trainingVideos', idVal);
                } else {
                    docRef = doc(collection(db, 'trainingVideos'));
                }
                
                await setDoc(docRef, {
                    id: docRef.id,
                    title: titleVal,
                    description: descVal,
                    videoUrl: urlVal
                }, { merge: true });
                
                if (videoModalInstance) videoModalInstance.hide();
            } catch (error) {
                console.error("Error saving video", error);
                alert("Failed to save video.");
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Video';
            }
        });
    }

    // --- Upload Logic ---
    uploadFileBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!storage) {
            alert("Firebase storage not configured.");
            return;
        }

        const fileRef = ref(storage, `Resources/${currentFolder}/${file.name}`);
        const uploadTask = uploadBytesResumable(fileRef, file);

        uploadProgressContainer.classList.remove('d-none');
        uploadFileName.textContent = `Uploading ${file.name}...`;
        uploadProgressBar.style.width = '0%';
        uploadProgressBar.setAttribute('aria-valuenow', 0);
        uploadProgressText.textContent = '0%';
        
        fileInput.value = '';

        uploadTask.on('state_changed', 
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                uploadProgressBar.style.width = progress + '%';
                uploadProgressBar.setAttribute('aria-valuenow', Math.round(progress));
                uploadProgressText.textContent = Math.round(progress) + '%';
            }, 
            (error) => {
                console.error("Upload failed", error);
                alert("Upload failed: " + error.message);
                uploadProgressContainer.classList.add('d-none');
            }, 
            () => {
                uploadProgressContainer.classList.add('d-none');
                loadFiles(currentFolder);
            }
        );
    });

    // --- Delete Logic ---
    let fileToDeletePath = null;
    let fileToDeleteName = null;
    let fileToDeleteType = null;
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    let deleteModalInstance = null;

    function attachDeleteListeners() {
        const deleteBtns = document.querySelectorAll('.delete-btn');
        deleteBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const button = e.currentTarget;
                fileToDeletePath = button.getAttribute('data-path');
                fileToDeleteName = button.getAttribute('data-name');
                fileToDeleteType = button.getAttribute('data-type');
                
                document.getElementById('deleteFileName').textContent = fileToDeleteName;
                
                const deleteModalEl = document.getElementById('deleteResourceModal');
                deleteModalInstance = bootstrap.Modal.getInstance(deleteModalEl) || new bootstrap.Modal(deleteModalEl);
                deleteModalInstance.show();
            });
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (!fileToDeletePath) return;
            
            const btnOriginalText = confirmDeleteBtn.textContent;
            confirmDeleteBtn.textContent = 'Deleting...';
            confirmDeleteBtn.disabled = true;

            try {
                if (fileToDeleteType === 'video') {
                    await deleteDoc(doc(db, 'trainingVideos', fileToDeletePath));
                } else if (fileToDeleteType === 'file') {
                    const fileRef = ref(storage, fileToDeletePath);
                    await deleteObject(fileRef);
                }
                
                if (deleteModalInstance) {
                    deleteModalInstance.hide();
                }
                if (fileToDeleteType === 'file') {
                    loadFiles(currentFolder);
                }
            } catch (error) {
                console.error("Error deleting", error);
                alert("Failed to delete: " + error.message);
            } finally {
                confirmDeleteBtn.textContent = btnOriginalText;
                confirmDeleteBtn.disabled = false;
                fileToDeletePath = null;
                fileToDeleteName = null;
                fileToDeleteType = null;
            }
        });
    }

    // Initial load
    loadFiles(currentFolder);
});
