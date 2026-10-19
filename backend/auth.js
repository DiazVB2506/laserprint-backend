/**
 * ==============================================================================
 * DISEÑO LASER PRINT — Autenticación del panel (auth.js)
 * ==============================================================================
 * - La contraseña vive en las variables de entorno de Render, nunca en el código.
 * - Al entrar, el servidor entrega un "pase" firmado que dura 8 horas.
 * - Crear, editar y borrar exigen ese pase (middleware requiereAdmin).
 * - Máximo 5 intentos fallidos por IP cada 15 minutos.
 *
 * Solo usa módulos que vienen con Node.js (sin dependencias extra).
 */
const crypto = require('crypto');

function crearAuth(opciones) {
  const cfg = Object.assign({
    usuario: process.env.ADMIN_USUARIO || '',
    password: process.env.ADMIN_PASSWORD || '',
    secreto: process.env.SESSION_SECRET || '',
    duracionMs: 8 * 60 * 60 * 1000,
    ventanaMs: 15 * 60 * 1000,
    maxFallos: 5,
    retrasoFalloMs: 400
  }, opciones || {});

  if (!cfg.secreto || cfg.secreto.length < 32) {
    cfg.secreto = crypto.randomBytes(48).toString('hex');
    console.warn('⚠️  SESSION_SECRET no está configurado (o es muy corto): las sesiones se cerrarán en cada reinicio.');
  }
  const configurado = Boolean(cfg.usuario && cfg.password);
  if (!configurado) {
    console.warn('⚠️  ADMIN_USUARIO / ADMIN_PASSWORD no están configurados: nadie podrá iniciar sesión.');
  }

  /* ---------- Firmas y comparaciones ---------- */

  function firmar(texto) {
    return crypto.createHmac('sha256', cfg.secreto).update(texto).digest('base64url');
  }

  /** Compara sin revelar por el tiempo de respuesta cuánto coinciden */
  function igualSeguro(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  function crearPase(usuario, ahora) {
    const exp = (ahora || Date.now()) + cfg.duracionMs;
    const datos = Buffer.from(JSON.stringify({ u: usuario, exp: exp })).toString('base64url');
    return { token: datos + '.' + firmar(datos), expira: exp };
  }

  function leerPase(pase, ahora) {
    if (typeof pase !== 'string') return null;
    const partes = pase.split('.');
    if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
    if (!igualSeguro(partes[1], firmar(partes[0]))) return null;
    try {
      const info = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
      if (!info || typeof info.exp !== 'number' || info.exp < (ahora || Date.now())) return null;
      return info;
    } catch (e) {
      return null;
    }
  }

  /* ---------- Límite de intentos ---------- */

  const fallos = new Map();

  function minutosBloqueado(ip, ahora) {
    ahora = ahora || Date.now();
    const r = fallos.get(ip);
    if (!r) return 0;
    if (ahora - r.inicio > cfg.ventanaMs) { fallos.delete(ip); return 0; }
    return r.n >= cfg.maxFallos ? Math.max(1, Math.ceil((r.inicio + cfg.ventanaMs - ahora) / 60000)) : 0;
  }

  function registrarFallo(ip, ahora) {
    ahora = ahora || Date.now();
    const r = fallos.get(ip);
    if (!r || ahora - r.inicio > cfg.ventanaMs) fallos.set(ip, { n: 1, inicio: ahora });
    else r.n++;
  }

  const limpieza = setInterval(function () {
    const ahora = Date.now();
    fallos.forEach(function (r, ip) { if (ahora - r.inicio > cfg.ventanaMs) fallos.delete(ip); });
  }, cfg.ventanaMs);
  if (limpieza.unref) limpieza.unref();

  /* ---------- Rutas y middleware de Express ---------- */

  async function login(req, res) {
    const ip = req.ip || 'desconocida';
    const minutos = minutosBloqueado(ip);
    if (minutos) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera ' + minutos + ' min e intenta de nuevo.' });
    }
    if (!configurado) {
      return res.status(503).json({ error: 'El acceso de administrador no está configurado en el servidor.' });
    }

    const body = req.body || {};
    const usuario = String(body.usuario || body.username || '').trim();
    const password = String(body.password || '');

    // Se comparan ambos siempre, aunque el usuario esté mal, para no dar pistas
    const okUsuario = igualSeguro(usuario, cfg.usuario);
    const okPassword = igualSeguro(password, cfg.password);

    if (!(okUsuario && okPassword)) {
      registrarFallo(ip);
      await new Promise(function (r) { setTimeout(r, cfg.retrasoFalloMs); });
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    fallos.delete(ip);
    return res.json(crearPase(usuario));
  }

  function requiereAdmin(req, res, next) {
    const encabezado = (req.get ? req.get('authorization') : req.headers && req.headers.authorization) || '';
    const pase = encabezado.indexOf('Bearer ') === 0 ? encabezado.slice(7).trim() : '';
    const info = leerPase(pase);
    if (!info) {
      return res.status(401).json({ error: 'Sesión no válida o expirada. Vuelve a iniciar sesión.' });
    }
    req.admin = info;
    next();
  }

  function verificar(req, res) {
    res.json({ ok: true, expira: req.admin.exp });
  }

  return {
    login: login,
    requiereAdmin: requiereAdmin,
    verificar: verificar,
    // expuestos para pruebas
    _crearPase: crearPase,
    _leerPase: leerPase,
    _igualSeguro: igualSeguro,
    _minutosBloqueado: minutosBloqueado,
    _registrarFallo: registrarFallo
  };
}

module.exports = { crearAuth: crearAuth };
