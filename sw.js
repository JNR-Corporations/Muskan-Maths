const CACHE_VERSION = "v2.0.0";

const STATIC_CACHE = `muskan-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `muskan-dynamic-${CACHE_VERSION}`;

const STATIC_FILES = [
    "./",
    "./index.html",
    "./manifest.json",

    "./logo192.png",
    "./logo512.png",
    "./logo512-maskable.png"
];

// INSTALL
self.addEventListener("install", event => {

    self.skipWaiting();

    event.waitUntil(
        caches.open(STATIC_CACHE)
        .then(cache => cache.addAll(STATIC_FILES))
    );

});

// ACTIVATE
self.addEventListener("activate", event => {

    event.waitUntil(

        caches.keys().then(keys => {

            return Promise.all(

                keys
                .filter(key =>
                    key !== STATIC_CACHE &&
                    key !== DYNAMIC_CACHE
                )
                .map(key => caches.delete(key))

            );

        })

    );

    self.clients.claim();

});

// FETCH
self.addEventListener("fetch", event => {

    if (event.request.method !== "GET") return;

    const url = new URL(event.request.url);

    // HTML
    if (event.request.mode === "navigate") {

        event.respondWith(

            fetch(event.request)
            .then(response => {

                const copy = response.clone();

                caches.open(DYNAMIC_CACHE)
                .then(cache => cache.put(event.request, copy));

                return response;

            })
            .catch(() => {

                return caches.match(event.request)
                .then(cache => {

                    return cache || caches.match("./index.html");

                });

            })

        );

        return;

    }

    // Fonts
    if (
        url.origin.includes("fonts.googleapis.com") ||
        url.origin.includes("fonts.gstatic.com")
    ) {

        event.respondWith(

            caches.match(event.request)
            .then(cache => {

                return cache || fetch(event.request)
                .then(response => {

                    const copy = response.clone();

                    caches.open(DYNAMIC_CACHE)
                    .then(c => c.put(event.request, copy));

                    return response;

                });

            })

        );

        return;

    }

    // FontAwesome CDN
    if (
        url.origin.includes("cdnjs.cloudflare.com")
    ) {

        event.respondWith(

            caches.match(event.request)
            .then(cache => {

                return cache || fetch(event.request)
                .then(response => {

                    const copy = response.clone();

                    caches.open(DYNAMIC_CACHE)
                    .then(c => c.put(event.request, copy));

                    return response;

                });

            })

        );

        return;

    }

    // Images
    if (
        event.request.destination === "image"
    ) {

        event.respondWith(

            caches.match(event.request)
            .then(cache => {

                return cache || fetch(event.request)
                .then(response => {

                    const copy = response.clone();

                    caches.open(DYNAMIC_CACHE)
                    .then(c => c.put(event.request, copy));

                    return response;

                });

            })

        );

        return;

    }

    // CSS / JS
    if (
        event.request.destination === "script" ||
        event.request.destination === "style"
    ) {

        event.respondWith(

            caches.match(event.request)
            .then(cache => {

                return cache || fetch(event.request)
                .then(response => {

                    const copy = response.clone();

                    caches.open(DYNAMIC_CACHE)
                    .then(c => c.put(event.request, copy));

                    return response;

                });

            })

        );

        return;

    }

    // Default
    event.respondWith(

        fetch(event.request)
        .catch(() => caches.match(event.request))

    );

});

// MESSAGE

self.addEventListener("message", event => {

    if (event.data === "SKIP_WAITING") {

        self.skipWaiting();

    }

});