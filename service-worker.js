// Kronexa PWA — Service Worker
// Cache offline + notificações push + atualização em background

const CACHE_NAME = 'kronexa-v2-' + new Date().toISOString().slice(0,10).replace(/-/g,'');
const STATIC_ASSETS = [
  '/portal-paciente.html',
  '/portal-agendamento.html',
  '/portal-exames.html',
  '/manifest.json',
  '/index.html'
];

const EXTERNAL_CDNS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com'
];

// ── INSTALL ──
self.addEventListener('install', event => {
  console.log('[SW] Instalando Kronexa PWA...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Cacheando assets estáticos');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Alguns assets não puderam ser cacheados:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  console.log('[SW] Ativado');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('[SW] Removendo cache antigo:', key);
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// ── FETCH (Network First com Cache Fallback) ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Não cachear chamadas de API / Supabase
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('generativelanguage.googleapis.com') ||
      url.pathname.includes('/rest/v1/') ||
      url.pathname.includes('/auth/v1/') ||
      url.pathname.includes('/storage/v1/')) {
    return; // fetch normalmente
  }

  // CDNs: Cache First (raramente mudam)
  if (EXTERNAL_CDNS.some(cdn => url.hostname.includes(cdn))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // HTML/JS/CSS: Network First
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          return cached || new Response('Offline — Conecte-se à internet para acessar este conteúdo.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
          });
        });
      })
  );
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
  let data = { title: 'Kronexa', body: 'Você tem uma nova notificação', icon: '/icon-192.png' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch(e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'kronexa-notif',
      data: data.data || {},
      vibrate: [200, 100, 200],
      requireInteraction: data.urgent || false,
      actions: data.actions || [
        { action: 'open', title: 'Abrir' },
        { action: 'close', title: 'Fechar' }
      ]
    })
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'close') return;

  const urlToOpen = event.notification.data?.url || '/portal-paciente.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existingClient = clients.find(c => c.url.includes(urlToOpen) || c.url.includes(self.location.origin));
      if (existingClient) {
        existingClient.focus();
      } else {
        clients.openWindow(urlToOpen);
      }
    })
  );
});

// ── BACKGROUND SYNC ──
self.addEventListener('sync', event => {
  if (event.tag === 'sync-exames') {
    event.waitUntil(syncPendingExams());
  }
});

async function syncPendingExams() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_EXAMES' });
  });
}

// ── MESSAGE HANDLER ──
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'SUBSCRIBE_PUSH') {
    subscribeToPush(event);
  }
});

async function subscribeToPush(event) {
  try {
    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.data?.vapidKey
    });
    // Enviar subscription para o servidor
    if (event.source) {
      event.source.postMessage({
        type: 'PUSH_SUBSCRIPTION',
        subscription: subscription
      });
    }
  } catch (err) {
    console.error('[SW] Erro ao assinar push:', err);
  }
}

console.log('[SW] Kronexa PWA Service Worker carregado — v2');
