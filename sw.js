/**
 * Muskan's Maths - Enterprise Production-Grade Service Worker
 * Architecture: Vanilla Modular JavaScript, Offline-First, Predictive Cache-Stratified
 * Version: 4.0.0 (2026 Enterprise Reference Baseline)
 */

// ============================================================================
// 1. CONFIGURATION & STATE MANAGEMENT
// ============================================================================

const DEBUG = false;
const VERSION = "v4.0.0";
const CACHE_PREFIX = "muskan-maths";

const CACHES = {
    APP_SHELL:     `${CACHE_PREFIX}-app-shell-${VERSION}`,
    HTML:          `${CACHE_PREFIX}-html-${VERSION}`,
    CSS:           `${CACHE_PREFIX}-css-${VERSION}`,
    JS:            `${CACHE_PREFIX}-js-${VERSION}`,
    FONTS_LOCAL:   `${CACHE_PREFIX}-fonts-local-${VERSION}`,
    FONTS_GOOGLE:  `${CACHE_PREFIX}-fonts-google-${VERSION}`,
    FONTS_AWESOME: `${CACHE_PREFIX}-fonts-awesome-${VERSION}`,
    IMAGES:        `${CACHE_PREFIX}-images-${VERSION}`,
    ICONS:         `${CACHE_PREFIX}-icons-${VERSION}`,
    MEDIA:         `${CACHE_PREFIX}-media-${VERSION}`,
    JSON_DATA:     `${CACHE_PREFIX}-json-${VERSION}`,
    API:           `${CACHE_PREFIX}-api-${VERSION}`,
    DYNAMIC:       `${CACHE_PREFIX}-dynamic-${VERSION}`,
    OFFLINE:       `${CACHE_PREFIX}-offline-${VERSION}`,
    MANIFEST:      `${CACHE_PREFIX}-manifest-${VERSION}`
};

const CACHE_TTL = {
    STATIC:   30 * 24 * 60 * 60 * 1000,
    FONTS:    90 * 24 * 60 * 60 * 1000,
    IMAGES:   15 * 24 * 60 * 60 * 1000,
    MEDIA:    7 * 24 * 60 * 60 * 1000,
    DYNAMIC:  7 * 24 * 60 * 60 * 1000,
    API:      1 * 60 * 60 * 1000      
};

const CACHE_MAX_ITEMS = {
    IMAGES: 150,
    DYNAMIC: 100,
    API: 50,
    MEDIA: 20
};

const CRITICAL_ASSETS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./logo192.png",
    "./logo512.png",
    "./logo512-maskable.png"
];

const OFFLINE_FALLBACK_HTML = "./index.html";
const OFFLINE_FALLBACK_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="100%" height="100%" fill="%23f3f4f6"/><text x="50%" y="50%" font-family="sans-serif" font-size="14" font-weight="bold" fill="%239ca3af" dominant-baseline="middle" text-anchor="middle">Offline | Muskan\'s Maths</text></svg>';
const OFFLINE_FALLBACK_JSON = JSON.stringify({ error: "Offline Mode Active", code: 503, data: null, offlineSupport: true });

const DB_NAME = "muskan-maths-sw-db";
const DB_VERSION = 1;
const STORES = {
    OUTBOX: "request-outbox",
    METADATA: "cache-metadata",
    PREDICTIVE: "predictive-analytics"
};

const broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('muskan-sw-channel') : null;

// ============================================================================
// 2. LOGGER ENGINE
// ============================================================================

const logger = {
    log:   (...args) => { if (DEBUG) console.log(`%c[SW:INFO]`, 'color: #10b981; font-weight: bold;', ...args); },
    warn:  (...args) => { if (DEBUG) console.warn(`%c[SW:WARN]`, 'color: #f59e0b; font-weight: bold;', ...args); },
    error: (...args) => { if (DEBUG) console.error(`%c[SW:ERROR]`, 'color: #ef4444; font-weight: bold;', ...args); }
};

// ============================================================================
// 3. INDEXEDDB MANAGER
// ============================================================================

const idb = {
    open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORES.OUTBOX)) {
                    db.createObjectStore(STORES.OUTBOX, { keyPath: "id", autoIncrement: true });
                }
                if (!db.objectStoreNames.contains(STORES.METADATA)) {
                    db.createObjectStore(STORES.METADATA, { keyPath: "url" });
                }
                if (!db.objectStoreNames.contains(STORES.PREDICTIVE)) {
                    db.createObjectStore(STORES.PREDICTIVE, { keyPath: "assetId" });
                }
            };
        });
    },

    async getTransaction(storeName, mode = "readonly") {
        const db = await this.open();
        return db.transaction(storeName, mode).objectStore(storeName);
    },

    async set(storeName, value) {
        return new Promise(async (resolve, reject) => {
            try {
                const store = await this.getTransaction(storeName, "readwrite");
                const request = store.put(value);
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            } catch (e) { reject(e); }
        });
    },

    async get(storeName, key) {
        return new Promise(async (resolve, reject) => {
            try {
                const store = await this.getTransaction(storeName, "readonly");
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (e) { reject(e); }
        });
    },

    async delete(storeName, key) {
        return new Promise(async (resolve, reject) => {
            try {
                const store = await this.getTransaction(storeName, "readwrite");
                const request = store.delete(key);
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            } catch (e) { reject(e); }
        });
    },

    async getAll(storeName) {
        return new Promise(async (resolve, reject) => {
            try {
                const store = await this.getTransaction(storeName, "readonly");
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (e) { reject(e); }
        });
    }
};

// ============================================================================
// 4. UTILITIES & CACHE INTEGRITY MANAGER
// ============================================================================

const buildMetaResponse = async (response) => {
    const copy = response.clone();
    const headers = new Headers(copy.headers);
    headers.append('X-SW-Cached-At', Date.now().toString());
    
    try {
        const body = await copy.blob();
        return new Response(body, {
            status: copy.status,
            statusText: copy.statusText,
            headers: headers
        });
    } catch {
        return response;
    }
};

const isExpired = (response, ttl) => {
    if (!ttl) return false;
    const cachedAt = response.headers.get('X-SW-Cached-At');
    if (!cachedAt) return false;
    return (Date.now() - parseInt(cachedAt, 10)) > ttl;
};

const validateResponse = (response) => {
    if (!response) return false;
    if (response.type === 'opaque') return true; // Accept opaque cross-origin assets safely
    if (response.status >= 200 && response.status < 400) return true;
    return false;
};

// ============================================================================
// 5. STORAGE & QUOTA MANAGER
// ============================================================================

const quotaManager = {
    async checkQuotaThreshold(triggerPrune = true) {
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const { quota, usage } = await navigator.storage.estimate();
                const usagePercentage = (usage / quota) * 100;
                logger.log(`Storage Usage Analytics: ${usagePercentage.toFixed(2)}% used.`);
                if (usagePercentage > 85 && triggerPrune) {
                    logger.warn("Storage usage exceeds critical 85% safety boundary. Evicting dynamic caches...");
                    await this.enforceLRUEviction();
                }
            } catch (e) {
                logger.error("Failed to accurately read storage quota profile Metrics.", e);
            }
        }
    },

    async enforceLRUEviction() {
        const dynamicCaches = [CACHES.DYNAMIC, CACHES.IMAGES, CACHES.MEDIA, CACHES.API];
        for (const cacheName of dynamicCaches) {
            try {
                const cache = await caches.open(cacheName);
                const keys = await cache.keys();
                // Safe progressive drop of older half of elements inside target caches
                const dropCount = Math.ceil(keys.length / 2);
                for (let i = 0; i < dropCount; i++) {
                    if (keys[i]) {
                        await cache.delete(keys[i]);
                        await idb.delete(STORES.METADATA, keys[i].url);
                    }
                }
                logger.log(`LRU Engine reclaimed allocations via evacuation inside: ${cacheName}`);
            } catch (err) {
                logger.error(`LRU Eviction operational engine failure on: ${cacheName}`, err);
            }
        }
    },

    async trimCacheSpace(cacheName, maxItems) {
        try {
            const cache = await caches.open(cacheName);
            const keys = await cache.keys();
            if (keys.length > maxItems) {
                const excess = keys.length - maxItems;
                for (let i = 0; i < excess; i++) {
                    await cache.delete(keys[i]);
                    await idb.delete(STORES.METADATA, keys[i].url);
                    logger.log(`Capacity Threshold Pruned Asset: ${keys[i].url}`);
                }
            }
        } catch (err) {
            logger.error(`Error pruning dynamic capacity constraints inside ${cacheName}:`, err);
        }
    }
};

const clearExpiredAssets = async () => {
    logger.log("Initiating structural global cache lifetime checks...");
    for (const [key, cacheName] of Object.entries(CACHES)) {
        try {
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();
            let ttl = CACHE_TTL.DYNAMIC;
            
            if (key.includes('STATIC') || key.includes('SHELL')) ttl = CACHE_TTL.STATIC;
            if (key.includes('FONTS')) ttl = CACHE_TTL.FONTS;
            if (key.includes('IMAGES')) ttl = CACHE_TTL.IMAGES;
            if (key.includes('API')) ttl = CACHE_TTL.API;
            if (key.includes('MEDIA')) ttl = CACHE_TTL.MEDIA;

            for (const request of requests) {
                const res = await cache.match(request);
                if (res && isExpired(res, ttl)) {
                    await cache.delete(request);
                    await idb.delete(STORES.METADATA, request.url);
                    logger.log(`Asset TTL Expired, structural purge: ${request.url}`);
                }
            }
        } catch (e) {
            logger.error(`Error structural self-healing routine for: ${cacheName}`, e);
        }
    }
};

// ============================================================================
// 6. STRATEGY ENGINE
// ============================================================================

const strategyEngine = {
    async cacheOnly(request) {
        const matched = await caches.match(request);
        if (matched) return matched;
        throw new Error(`CacheOnly strategic missing lookup asset hit for: ${request.url}`);
    },

    async networkOnly(request, timeout = 15000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const networkResponse = await fetch(request, { signal: controller.signal });
            clearTimeout(timeoutId);
            return networkResponse;
        } catch (e) {
            clearTimeout(timeoutId);
            throw e;
        }
    },

    async cacheFirst(request, cacheName, ttl = null) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse && !isExpired(cachedResponse, ttl)) {
            // Log access timestamp to index DB asynchronously for deep analytical metrics tracking
            idb.set(STORES.METADATA, { url: request.url, lastAccessed: Date.now(), cacheName }).catch(() => {});
            return cachedResponse;
        }
        
        try {
            const networkResponse = await fetch(request.clone());
            if (validateResponse(networkResponse)) {
                const cache = await caches.open(cacheName);
                const targetedResponse = await buildMetaResponse(networkResponse);
                await cache.put(request, targetedResponse);
                await idb.set(STORES.METADATA, { url: request.url, lastAccessed: Date.now(), cacheName });
            }
            return networkResponse;
        } catch (error) {
            if (cachedResponse) return cachedResponse;
            return offlineManager.routeFallback(request);
        }
    },

    async networkFirst(request, cacheName, ttl = null, timeout = 8000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const preloadResponse = await request.preloadResponse;
            const networkResponse = preloadResponse || await fetch(request.clone(), { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (validateResponse(networkResponse)) {
                const cache = await caches.open(cacheName);
                const targetedResponse = await buildMetaResponse(networkResponse);
                await cache.put(request, targetedResponse);
                await idb.set(STORES.METADATA, { url: request.url, lastAccessed: Date.now(), cacheName });
            }
            return networkResponse;
        } catch (error) {
            clearTimeout(timeoutId);
            logger.warn(`Network path failure/timeout on: ${request.url}. Fetching fallback cache core matrices.`);
            const cachedResponse = await caches.match(request);
            if (cachedResponse && !isExpired(cachedResponse, ttl)) return cachedResponse;
            return offlineManager.routeFallback(request);
        }
    },

    async staleWhileRevalidate(request, cacheName, maxItems = null) {
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);
        
        const fetchPromise = fetch(request.clone()).then(async (networkResponse) => {
            if (validateResponse(networkResponse)) {
                const targetedResponse = await buildMetaResponse(networkResponse);
                await cache.put(request, targetedResponse);
                await idb.set(STORES.METADATA, { url: request.url, lastAccessed: Date.now(), cacheName });
                if (maxItems) await quotaManager.trimCacheSpace(cacheName, maxItems);
            }
            return networkResponse;
        }).catch(err => logger.error(`Revalidation background engine failure: ${request.url}`, err));

        return cachedResponse || fetchPromise;
    },

    async timeoutNetworkStrategy(request, cacheName, timeout = 3000) {
        return this.networkFirst(request, cacheName, null, timeout);
    },

    async raceStrategy(request, cacheName) {
        return new Promise((resolve, reject) => {
            let failed = 0;
            const primaryErrors = [];
            
            const handleResult = (res) => {
                if (res) resolve(res);
                else handleError(new Error("Empty structural payload target asset element."));
            };

            const handleError = (err) => {
                failed++;
                primaryErrors.push(err);
                if (failed >= 2) {
                    reject(new Error(`Race Strategy complete connection disruption failure: ${primaryErrors.join(', ')}`));
                }
            };

            fetch(request.clone())
                .then(res => {
                    if (validateResponse(res)) {
                        caches.open(cacheName).then(c => c.put(request, res.clone()));
                        resolve(res);
                    } else handleError(new Error("Invalid network response profile."));
                })
                .catch(handleError);

            caches.match(request)
                .then(res => { if (res) resolve(res); else handleError(new Error("Cache target element lookup failure.")); })
                .catch(handleError);
        });
    }
};

// ============================================================================
// 7. OFFLINE RESOURCE ROUTER MANAGER
// ============================================================================

const offlineManager = {
    async routeFallback(request) {
        const url = new URL(request.url);
        if (request.mode === 'navigate') {
            const baseFallback = await caches.match(OFFLINE_FALLBACK_HTML);
            if (baseFallback) return baseFallback;
        }
        if (request.destination === 'image' || /\.(png|jpg|jpeg|gif|webp|avif|svg)$/i.test(url.pathname)) {
            return new Response(OFFLINE_FALLBACK_IMAGE, { headers: { 'Content-Type': 'image/svg+xml' } });
        }
        if (url.pathname.includes("/api/") || url.pathname.endsWith(".json") || request.destination === 'json') {
            return new Response(OFFLINE_FALLBACK_JSON, { headers: { 'Content-Type': 'application/json' } });
        }
        return new Response("Muskan's Maths offline core systems validation missing element.", { status: 503, statusText: "Offline Matrix Operational Fault" });
    }
};

// ============================================================================
// 8. PREDICTIVE DISPATCH ENGINE
// ============================================================================

const predictiveEngine = {
    async prefetchIntelligentLinks(urls) {
        if (!urls || !Array.isArray(urls)) return;
        logger.log(`Predictive Engine Processing Target Task List: ${urls.length} target elements.`);
        
        const runtimeWorkerCache = await caches.open(CACHES.DYNAMIC);
        for (const url of urls) {
            try {
                const checked = await caches.match(url);
                if (!checked) {
                    const fetchResponse = await fetch(url);
                    if (validateResponse(fetchResponse)) {
                        const modifiedRes = await buildMetaResponse(fetchResponse);
                        await runtimeWorkerCache.put(url, modifiedRes);
                        logger.log(`Predictively pre-fetched deployment asset item: ${url}`);
                    }
                }
            } catch (err) {
                logger.error(`Failed predictive fetch operational mapping step on asset: ${url}`, err);
            }
        }
    }
};

// ============================================================================
// 9. RESOURCE LIFECYCLE SCHEDULER
// ============================================================================

self.addEventListener("install", (event) => {
    logger.log("Enterprise Application Installation Sequence Init.");
    self.skipWaiting();
    
    event.waitUntil(
        (async () => {
            try {
                const shellCache = await caches.open(CACHES.APP_SHELL);
                await shellCache.addAll(CRITICAL_ASSETS);
                
                const offlineCache = await caches.open(CACHES.OFFLINE);
                await offlineCache.put(OFFLINE_FALLBACK_HTML, await fetch(OFFLINE_FALLBACK_HTML));
                
                logger.log("Pre-cache Structural Core Matrix Infrastructure Deployment Complete.");
            } catch (err) {
                logger.error("Critical Abort Intercepted on Base Installation Phase Routine:", err);
            }
        })()
    );
});

self.addEventListener("activate", (event) => {
    logger.log("Enterprise Structural Activation Lifecycle System Triggered.");
    
    event.waitUntil(
        (async () => {
            if (self.registration.navigationPreload) {
                await self.registration.navigationPreload.enable();
                logger.log("Dynamic Navigation Preload Engine activated successfully.");
            }
            
            const expectedCaches = Object.values(CACHES);
            const currentStoreKeys = await caches.keys();
            
            await Promise.all(
                currentStoreKeys.map((key) => {
                    if (!expectedCaches.includes(key)) {
                        logger.warn(`Evicting structural obsolete legacy cache storage sector: ${key}`);
                        return caches.delete(key);
                    }
                })
            );
            
            await self.clients.claim();
            await clearExpiredAssets();
            await quotaManager.checkQuotaThreshold(true);
            
            updateManager.broadcastSystemState({ type: "SW_STATE_READY", version: VERSION });
        })()
    );
});

// ============================================================================
// 10. SYSTEM DISPATCH INTELLIGENT ROUTER (FETCH EVENT LAYER)
// ============================================================================

self.addEventListener("fetch", (event) => {
    const request = event.request;
    
    // Safety check bypass to enforce strict clean transport parameters
    if (request.method !== "GET" || request.url.startsWith('chrome-extension://')) return;

    const url = new URL(request.url);
    const destination = request.destination;

    // Cross-Origin Architecture Router Interceptors
    if (url.origin !== self.location.origin) {
        if (url.origin.includes("fonts.googleapis.com") || url.origin.includes("fonts.gstatic.com")) {
            event.respondWith(strategyEngine.cacheFirst(request, CACHES.FONTS_GOOGLE, CACHE_TTL.FONTS));
            return;
        }
        if (url.origin.includes("cdnjs.cloudflare.com")) {
            event.respondWith(strategyEngine.cacheFirst(request, CACHES.FONTS_AWESOME, CACHE_TTL.FONTS));
            return;
        }
        if (url.origin.includes("firebase") || url.origin.includes("googleapis.com")) {
            event.respondWith(strategyEngine.timeoutNetworkStrategy(request, CACHES.API, 5000));
            return;
        }
        
        // General Opaque Fallback Routing Security Safeguard Layer
        event.respondWith(strategyEngine.staleWhileRevalidate(request, CACHES.DYNAMIC, CACHE_MAX_ITEMS.DYNAMIC));
        return;
    }

    // Navigation Interceptor (HTML Structural Templates)
    if (request.mode === "navigate") {
        event.respondWith(strategyEngine.networkFirst(request, CACHES.HTML, null, 6000));
        return;
    }

    // Web Standard Application Manifest Execution Paths
    if (url.pathname.endsWith("manifest.json") || destination === "manifest") {
        event.respondWith(strategyEngine.staleWhileRevalidate(request, CACHES.MANIFEST));
        return;
    }

    // Dynamic Database Operations Layer Queries
    if (url.pathname.includes("/api/") || url.pathname.endsWith(".json")) {
        event.respondWith(strategyEngine.networkFirst(request, CACHES.API, CACHE_TTL.API, 4000));
        return;
    }

    // Executable Code Script Architecture Layers
    if (destination === "script" || url.pathname.endsWith(".js")) {
        const cacheStore = CRITICAL_ASSETS.includes(url.pathname) ? CACHES.APP_SHELL : CACHES.JS;
        event.respondWith(strategyEngine.staleWhileRevalidate(request, cacheStore));
        return;
    }

    // Interface Cascading Formatting Stylesheets
    if (destination === "style" || url.pathname.endsWith(".css")) {
        const cacheStore = CRITICAL_ASSETS.includes(url.pathname) ? CACHES.APP_SHELL : CACHES.CSS;
        event.respondWith(strategyEngine.staleWhileRevalidate(request, cacheStore));
        return;
    }

    // Graphics Vector and Image Delivery Systems Optimization Engine
    if (destination === "image" || /\.(png|jpg|jpeg|gif|webp|avif|svg|ico)$/i.test(url.pathname)) {
        const isIcon = url.pathname.includes("icon") || url.pathname.includes("logo");
        const cacheStore = isIcon ? CACHES.ICONS : CACHES.IMAGES;
        event.respondWith(strategyEngine.cacheFirst(request, cacheStore, CACHE_TTL.IMAGES));
        return;
    }

    // Interface Audio/Video Pipeline Components
    if (destination === "video" || destination === "audio" || /\.(mp4|webm|ogg|mp3|wav)$/i.test(url.pathname)) {
        event.respondWith(strategyEngine.cacheFirst(request, CACHES.MEDIA, CACHE_TTL.MEDIA));
        return;
    }

    // Static Local Domain Web Typography System
    if (destination === "font" || /\.(woff|woff2|eot|ttf|otf)$/i.test(url.pathname)) {
        event.respondWith(strategyEngine.cacheFirst(request, CACHES.FONTS_LOCAL, CACHE_TTL.FONTS));
        return;
    }

    // Structural Catch-all Matrix System
    event.respondWith(strategyEngine.staleWhileRevalidate(request, CACHES.DYNAMIC, CACHE_MAX_ITEMS.DYNAMIC));
});

// ============================================================================
// 11. BACKGROUND SYNC & DATA OUTBOX QUEUE SYSTEMS
// ============================================================================

const syncManager = {
    async queuePostData(url, payload, headers = {}) {
        logger.warn(`Intercepted system network transaction failure. Staging entry directly inside offline recovery buffer.`);
        const serializedHeaders = Array.from(new Headers(headers).entries());
        await idb.set(STORES.OUTBOX, {
            url,
            payload,
            headers: serializedHeaders,
            timestamp: Date.now()
        });
        
        if (self.registration.sync) {
            await self.registration.sync.register("muskan-outbox-sync");
        }
    },

    async processOutboxQueue() {
        try {
            const pendingRequests = await idb.getAll(STORES.OUTBOX);
            if (!pendingRequests || pendingRequests.length === 0) return;

            logger.log(`Background Outbox Synchronizer Active. Executing ${pendingRequests.length} queued records.`);
            for (const record of pendingRequests) {
                try {
                    const response = await fetch(record.url, {
                        method: "POST",
                        body: JSON.stringify(record.payload),
                        headers: new Headers(record.headers)
                    });
                    if (response.status >= 200 && response.status < 300) {
                        await idb.delete(STORES.OUTBOX, record.id);
                        logger.log(`Successfully sync replayed structured transaction task execution record: ${record.id}`);
                    }
                } catch (e) {
                    logger.error(`Failed connection handshake retry phase loop on outbox task item: ${record.id}`, e);
                    break; 
                }
            }
        } catch (err) {
            logger.error("Error executing background sync operational processing pipeline queue system:", err);
        }
    }
};

self.addEventListener("sync", (event) => {
    if (event.tag === "muskan-outbox-sync" || event.tag === "sync") {
        event.waitUntil(syncManager.processOutboxQueue());
    }
});

self.addEventListener("periodicsync", (event) => {
    if (event.tag === "muskan-periodic-clean") {
        event.waitUntil(Promise.all([clearExpiredAssets(), quotaManager.checkQuotaThreshold(true)]));
    }
});

// ============================================================================
// 12. ADVANCED PUSH NOTIFICATIONS & INTER-ACTION ARCHITECTURE
// ============================================================================

self.addEventListener("push", (event) => {
    logger.log("Push payload structural event delivery channel active.");
    
    let contents = { title: "Muskan's Maths", body: "Core curriculum syllabus updates are published.", icon: "./logo192.png", badge: "./logo192.png" };
    try {
        if (event.data) contents = event.data.json();
    } catch {
        if (event.data) contents.body = event.data.text();
    }

    const flags = {
        body: contents.body,
        icon: contents.icon || "./logo192.png",
        badge: contents.badge || "./logo192.png",
        vibrate: [150, 75, 150],
        tag: contents.tag || "muskan-maths-notification-id",
        renotify: true,
        requireInteraction: contents.requireInteraction || false,
        data: contents.data || { url: "/" },
        actions: contents.actions || [
            { action: "launch", title: "View Dashboard" },
            { action: "dismiss", title: "Dismiss" }
        ]
    };

    event.waitUntil(self.registration.showNotification(contents.title, flags));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    
    if (event.action === "dismiss") {
        logger.log("Notification dismissed by user client selection.");
        return;
    }

    const routeTarget = event.notification.data?.url || '/';
    
    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
                if (client.url === routeTarget && "focus" in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow(routeTarget);
        })
    );
});

// ============================================================================
// 13. UPDATE & PROCESS BROADCAST COMMUNICATOR (IPC RUNTIME LAYER)
// ============================================================================

const updateManager = {
    broadcastSystemState(msg) {
        if (broadcast) {
            broadcast.postMessage(msg);
        } else {
            self.clients.matchAll({ includeUncontrolled: true }).then((windows) => {
                windows.forEach((win) => win.postMessage(msg));
            });
        }
    }
};

self.addEventListener("message", (event) => {
    if (!event.data) return;

    const task = event.data.type || event.data;
    logger.log(`IPC Structural Command Dispatched Ingress: ${task}`);

    if (task === "SKIP_WAITING") {
        self.skipWaiting();
    }
    
    if (task === "PREDICTIVE_PREFETCH_TRIGGER" && event.data.urls) {
        event.waitUntil(predictiveEngine.prefetchIntelligentLinks(event.data.urls));
    }

    if (task === "MANUAL_PURGE_TRIGGER") {
        event.waitUntil(Promise.all([clearExpiredAssets(), quotaManager.enforceLRUEviction()]));
    }
});