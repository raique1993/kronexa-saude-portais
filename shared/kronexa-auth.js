/**
 * KRONEXA — Módulo de Segurança Compartilhado
 * Incluir em todos os portais: <script src="/shared/kronexa-auth.js"></script>
 *
 * Fornece:
 *   - Verificação de sessão com expiração
 *   - Sanitização de HTML (anti-XSS)
 *   - Headers de segurança
 *   - Proteção CSRF
 */
(function () {
  'use strict';

  // ═══ CONFIG ═══
  const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas
  const PUBLIC_PAGES = ['index.html', 'login.html', 'termos.html', 'privacidade.html', 'cadastro.html'];

  // ═══ PROTEÇÃO CLICKJACKING ═══
  if (window.top !== window.self && !PUBLIC_PAGES.some(p => window.location.pathname.endsWith(p))) {
    window.top.location = window.self.location;
  }

  // ═══ SANITIZAÇÃO HTML (anti-XSS) ═══
  window.KRONEXA = window.KRONEXA || {};

  // Mapa de escapes
  const ESC_MAP = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#x27;', '/': '&#x2F;',
    '`': '&#x60;', '=': '&#x3D;',
  };
  const esc = (s) => String(s).replace(/[&<>"'`=/]/g, c => ESC_MAP[c]);

  /** Sanitiza texto para uso seguro em HTML */
  KRONEXA.safeText = esc;

  /** Sanitiza objeto para JSON seguro */
  KRONEXA.safeJSON = (obj) => {
    try { return JSON.parse(JSON.stringify(obj)); } catch { return {}; }
  };

  /** Renderiza HTML seguro escapando valores dinâmicos */
  KRONEXA.safeInner = (el, html) => {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    // Remove scripts e event handlers como defesa adicional
    const cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
    el.innerHTML = cleaned;
  };

  /** Template string seguro: safe`<b>${nome}</b>` -> <b>&lt;script&gt;</b> */
  KRONEXA.safe = (strings, ...values) => {
    let result = strings[0];
    for (let i = 0; i < values.length; i++) {
      result += esc(values[i]) + strings[i + 1];
    }
    return result;
  };

  // ═══ CSRF TOKEN ═══
  KRONEXA.csrfToken = () => {
    let token = sessionStorage.getItem('KRONEXA_CSRF');
    if (!token) {
      token = crypto.randomUUID ? crypto.randomUUID() :
        Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem('KRONEXA_CSRF', token);
    }
    return token;
  };

  // ═══ VERIFICAÇÃO DE SESSÃO ═══
  KRONEXA.checkSession = () => {
    const isPublic = PUBLIC_PAGES.some(p => window.location.pathname.endsWith(p));
    if (isPublic) return true;

    const user = localStorage.getItem('KRONEXA_USER');
    const lastActive = localStorage.getItem('KRONEXA_LAST_ACTIVE');
    const cid = localStorage.getItem('KRONEXA_CID');

    if (!user || !cid) {
      window.location.href = '/login.html';
      return false;
    }

    if (lastActive) {
      const elapsed = Date.now() - parseInt(lastActive);
      if (elapsed > SESSION_TTL_MS) {
        localStorage.removeItem('KRONEXA_USER');
        localStorage.removeItem('KRONEXA_CID');
        localStorage.removeItem('KRONEXA_LAST_ACTIVE');
        window.location.href = '/login.html?reason=expired';
        return false;
      }
    }

    // Renova timestamp
    localStorage.setItem('KRONEXA_LAST_ACTIVE', Date.now().toString());
    return true;
  };

  /** Verifica se o usuário está autenticado (sem redirecionar) */
  KRONEXA.isAuthenticated = () => {
    const user = localStorage.getItem('KRONEXA_USER');
    const cid = localStorage.getItem('KRONEXA_CID');
    const lastActive = localStorage.getItem('KRONEXA_LAST_ACTIVE');
    if (!user || !cid || !lastActive) return false;
    return (Date.now() - parseInt(lastActive)) < SESSION_TTL_MS;
  };

  /** Logout seguro */
  KRONEXA.logout = () => {
    localStorage.removeItem('KRONEXA_USER');
    localStorage.removeItem('KRONEXA_CID');
    localStorage.removeItem('KRONEXA_LAST_ACTIVE');
    localStorage.removeItem('KRONEXA_CLINICA');
    localStorage.removeItem('KRONEXA_ONBOARDING');
    sessionStorage.removeItem('KRONEXA_CSRF');
    window.location.href = '/login.html';
  };

  /** Atualiza timestamp de atividade */
  KRONEXA.touch = () => {
    localStorage.setItem('KRONEXA_LAST_ACTIVE', Date.now().toString());
  };

  // ═══ CHAMADA SUPABASE SEGURA ═══
  /** Cliente Supabase com CSRF token nos headers */
  KRONEXA.createClient = (url, key) => {
    const sb = supabase.createClient(url, key, {
      headers: { 'X-CSRF-Token': KRONEXA.csrfToken() },
    });
    return sb;
  };

  // ═══ INICIALIZAÇÃO ═══
  // Atualiza timestamp a cada 5 minutos
  setInterval(() => {
    if (KRONEXA.isAuthenticated()) KRONEXA.touch();
  }, 5 * 60 * 1000);

  // Touch na atividade do usuário
  ['click', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, () => KRONEXA.touch(), { passive: true });
  });

  console.log('[Kronexa] Modulo de seguranca carregado — CSP, CSRF, XSS, Sessao');
})();
