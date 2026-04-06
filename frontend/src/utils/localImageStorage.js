/**
 * Utility for storing images in IndexedDB to bypass localStorage quota limits (5MB).
 * IndexedDB typically allows hundreds of MBs or more depending on the browser.
 */

const DB_NAME = 'EpubEditorDB';
const DB_VERSION = 1;
const STORE_NAME = 'local_images';

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'storageKey' });
      }
    };
  });
};

export const saveLocalImages = async (jobId, images) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const storageKey = `epub_local_images_${jobId}`;
    
    await new Promise((resolve, reject) => {
      const request = store.put({ storageKey, images });
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
    
    console.log(`[localImageStorage] Saved ${images.length} images to IndexedDB for jobId ${jobId}`);
  } catch (error) {
    console.error('[localImageStorage] Failed to save images to IndexedDB:', error);
    throw error;
  }
};

export const getLocalImages = async (jobId) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const storageKey = `epub_local_images_${jobId}`;
    
    const result = await new Promise((resolve, reject) => {
      const request = store.get(storageKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
    
    return result ? result.images : [];
  } catch (error) {
    console.error('[localImageStorage] Failed to get images from IndexedDB:', error);
    return [];
  }
};

export const deleteLocalImages = async (jobId) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const storageKey = `epub_local_images_${jobId}`;
    
    await new Promise((resolve, reject) => {
      const request = store.delete(storageKey);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
    
    console.log(`[localImageStorage] Deleted images for jobId ${jobId}`);
  } catch (error) {
    console.error('[localImageStorage] Failed to delete images from IndexedDB:', error);
  }
};

