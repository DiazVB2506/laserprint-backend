/**
 * ==============================================================================
 * DISEÑO LASER PRINT — API (server.js v2.0)
 * ==============================================================================
 *
 * VARIABLES DE ENTORNO (se configuran en Render → Environment, NUNCA en el código):
 *
 *   MONGODB_URI            Conexión a MongoDB (ya la tienes)
 *   ADMIN_USUARIO          Usuario del panel
 *   ADMIN_PASSWORD         Contraseña del panel (usa una NUEVA)
 *   SESSION_SECRET         Texto largo y aleatorio para firmar las sesiones
 *                          (en Render usa el botón "Generate")
 *   CLOUDINARY_CLOUD_NAME  ┐
 *   CLOUDINARY_API_KEY     ├ Para guardar archivos en Cloudinary (recomendado:
 *   CLOUDINARY_API_SECRET  ┘ el disco de Render se borra en cada reinicio)
 *   ALLOWED_ORIGINS        (Opcional) dominios extra separados por coma
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
require('dotenv').config();

const Producto = require('./models/Producto');

const app = express();
app.set('trust proxy', 1);          // Render está detrás de un proxy: así req.ip es la IP real
app.disable('x-powered-by');

/* ==========================================================================
   1. CORS: solo tu sitio puede usar la API desde el navegador
   ========================================================================== */

const ORIGENES_PERMITIDOS = [
  'https://diazvb2506.github.io',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
];

app.use(cors({
  origin(origin, cb) {
    // Sin "origin" = peticiones del mismo servidor, curl, apps. Las protege el login.
    if (!origin) return cb(null, true);
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    cb(null, local || ORIGENES_PERMITIDOS.includes(origin));
  },
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 86400
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/* ==========================================================================
   2. AUTENTICACIÓN (toda la lógica está en auth.js)
   ========================================================================== */

const { crearAuth } = require('./auth');
const auth = crearAuth();
const requiereAdmin = auth.requiereAdmin;

app.post('/api/login', auth.login);
app.get('/api/auth/verificar', requiereAdmin, auth.verificar);

/* ==========================================================================
   3. ALMACENAMIENTO DE ARCHIVOS
   - Con Cloudinary configurado: los archivos se guardan ahí y no se pierden.
   - Sin Cloudinary: se guardan en el disco del servidor (en Render gratis
     se BORRAN en cada reinicio o despliegue).
   ========================================================================== */

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'application/pdf'];

function clasificar(mimetype) {
  if (mimetype.startsWith('video/')) return { tipoArchivo: 'video', carpeta: 'videos', recurso: 'video' };
  if (mimetype === 'application/pdf') return { tipoArchivo: 'pdf', carpeta: 'documentos', recurso: 'raw' };
  return { tipoArchivo: 'imagen', carpeta: 'fotos', recurso: 'image' };
}

const nombreUnico = () => Date.now() + '-' + crypto.randomBytes(6).toString('hex');

const USA_CLOUDINARY = Boolean(
  process.env.CLOUDINARY_URL ||
  (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);

let cloudinary = null;
let storage;

if (USA_CLOUDINARY) {
  cloudinary = require('cloudinary').v2;
  const { CloudinaryStorage } = require('multer-storage-cloudinary');

  if (!process.env.CLOUDINARY_URL) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
  }

  storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      const info = clasificar(file.mimetype);
      return {
        folder: 'laserprint/' + info.carpeta,
        resource_type: info.recurso,
        // Los PDF se suben como "raw": el id necesita la extensión
        public_id: nombreUnico() + (info.recurso === 'raw' ? '.pdf' : '')
      };
    }
  });
  console.log('☁️  Archivos: Cloudinary');
} else {
  ['fotos', 'videos', 'documentos'].forEach(dir => {
    fs.mkdirSync(path.join(__dirname, 'uploads', dir), { recursive: true });
  });

  storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads', clasificar(file.mimetype).carpeta)),
    filename: (req, file, cb) => cb(null, nombreUnico() + path.extname(file.originalname).toLowerCase())
  });
  console.warn('⚠️  Archivos: disco local. En Render gratis se borran en cada reinicio. Configura Cloudinary.');
}

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (TIPOS_PERMITIDOS.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato no permitido. Solo imágenes (JPG, PNG, WEBP, GIF), MP4 o PDF.'));
  }
});

/** Datos del archivo recién subido, listos para guardar en la base de datos */
function datosDeArchivo(req) {
  const info = clasificar(req.file.mimetype);
  if (USA_CLOUDINARY) {
    return {
      tipoArchivo: info.tipoArchivo,
      archivoUrl: req.file.path,           // URL https de Cloudinary
      archivoPublicId: req.file.filename,  // id para poder borrarlo después
      archivoRecurso: info.recurso
    };
  }
  const base = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  return {
    tipoArchivo: info.tipoArchivo,
    archivoUrl: `${base}/uploads/${info.carpeta}/${req.file.filename}`,
    archivoPublicId: null,
    archivoRecurso: null
  };
}

/** Borra el archivo de un producto (Cloudinary o disco). Nunca lanza error. */
async function borrarArchivo(producto) {
  if (!producto) return;
  try {
    if (producto.archivoPublicId && cloudinary) {
      await cloudinary.uploader.destroy(producto.archivoPublicId, {
        resource_type: producto.archivoRecurso || 'image',
        invalidate: true
      });
      return;
    }
    if (producto.archivoUrl) {
      const ruta = new URL(producto.archivoUrl, 'http://localhost').pathname;
      if (!ruta.startsWith('/uploads/')) return;
      const carpetaUploads = path.join(__dirname, 'uploads');
      const archivo = path.resolve(__dirname, '.' + decodeURIComponent(ruta));
      // Solo borra dentro de /uploads (evita rutas como ../../)
      if (archivo.startsWith(carpetaUploads + path.sep) && fs.existsSync(archivo)) fs.unlinkSync(archivo);
    }
  } catch (e) {
    console.warn('⚠️  No se pudo borrar el archivo:', e.message);
  }
}

/** Si algo falla después de subir, borra el archivo para no dejar basura */
async function limpiarSubida(req) {
  if (!req.file) return;
  const d = datosDeArchivo(req);
  await borrarArchivo(d);
}

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d' }));

/* ==========================================================================
   4. BASE DE DATOS
   ========================================================================== */

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/laserprint';

mongoose.connect(MONGODB_URI, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
})
  .then(() => console.log('🟢 MongoDB conectada'))
  .catch(err => console.error('🔴 Error de conexión a MongoDB:', err.message));

const esIdValido = (id) => mongoose.Types.ObjectId.isValid(id);

function precioDesde(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* ==========================================================================
   5. API DE PRODUCTOS
   ========================================================================== */

// Público: lo usan el inicio y las páginas de cada sección
app.get('/api/productos', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));

    const filtro = { activo: true };
    if (req.query.categoria) filtro.categoria = String(req.query.categoria).toUpperCase();

    const [productos, total] = await Promise.all([
      Producto.find(filtro)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('-archivoPublicId -archivoRecurso -__v')
        .lean(),
      Producto.countDocuments(filtro)
    ]);

    res.set('Cache-Control', 'public, max-age=60');
    res.json({ total, paginaActual: page, totalPaginas: Math.ceil(total / limit), productos });
  } catch (error) {
    console.error('Error al obtener productos:', error.message);
    res.status(500).json({ error: 'Error al consultar el catálogo.' });
  }
});

// Protegido: crear
app.post('/api/productos', requiereAdmin, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Debes seleccionar un archivo válido.' });

    const { nombre, descripcion, categoria } = req.body;
    const producto = await Producto.create({
      nombre,
      descripcion,
      categoria,
      precio: precioDesde(req.body.precio),
      ...datosDeArchivo(req)
    });

    console.log('✅ Publicación creada:', producto.nombre);
    res.status(201).json({ mensaje: 'Publicación guardada.', producto });
  } catch (error) {
    await limpiarSubida(req);
    const esValidacion = error.name === 'ValidationError';
    console.error('Error al guardar:', error.message);
    res.status(esValidacion ? 400 : 500).json({
      error: esValidacion ? Object.values(error.errors).map(e => e.message).join(' ') : 'Error al guardar la publicación.'
    });
  }
});

// Protegido: editar
app.put('/api/productos/:id', requiereAdmin, upload.single('archivo'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!esIdValido(id)) { await limpiarSubida(req); return res.status(400).json({ error: 'ID no válido.' }); }

    const existente = await Producto.findById(id);
    if (!existente) { await limpiarSubida(req); return res.status(404).json({ error: 'Publicación no encontrada.' }); }

    const { nombre, descripcion, categoria } = req.body;
    if (nombre !== undefined) existente.nombre = nombre;
    if (descripcion !== undefined) existente.descripcion = descripcion;
    if (categoria !== undefined) existente.categoria = categoria;
    // Precio vacío = quitar el precio (antes no se podía borrar)
    if (req.body.precio !== undefined) existente.precio = precioDesde(req.body.precio);

    const anterior = { archivoUrl: existente.archivoUrl, archivoPublicId: existente.archivoPublicId, archivoRecurso: existente.archivoRecurso };
    if (req.file) Object.assign(existente, datosDeArchivo(req));

    await existente.save();
    if (req.file) await borrarArchivo(anterior);   // el viejo se borra solo si todo salió bien

    console.log('✏️  Publicación actualizada:', existente.nombre);
    res.json({ mensaje: 'Publicación actualizada.', producto: existente });
  } catch (error) {
    await limpiarSubida(req);
    const esValidacion = error.name === 'ValidationError';
    console.error('Error al actualizar:', error.message);
    res.status(esValidacion ? 400 : 500).json({
      error: esValidacion ? Object.values(error.errors).map(e => e.message).join(' ') : 'Error al actualizar la publicación.'
    });
  }
});

// Protegido: eliminar
app.delete('/api/productos/:id', requiereAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!esIdValido(id)) return res.status(400).json({ error: 'ID no válido.' });

    const producto = await Producto.findByIdAndDelete(id);
    if (!producto) return res.status(404).json({ error: 'Publicación no encontrada.' });

    await borrarArchivo(producto);
    console.log('🗑️  Publicación eliminada:', producto.nombre);
    res.json({ mensaje: 'Publicación eliminada.' });
  } catch (error) {
    console.error('Error al eliminar:', error.message);
    res.status(500).json({ error: 'Error al eliminar la publicación.' });
  }
});

/* ==========================================================================
   6. ESTADO, ERRORES Y RUTAS NO ENCONTRADAS
   ========================================================================== */

app.get('/', (req, res) => {
  res.json({ status: 'API LaserPrint operativa', archivos: USA_CLOUDINARY ? 'cloudinary' : 'disco' });
});

// Errores de subida (archivo muy grande, formato no permitido…)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa más de 50 MB.' : `Error de subida: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  if (err) {
    console.error('Error:', err.message);
    return res.status(400).json({ error: err.message || 'Petición no válida.' });
  }
  next();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Recurso no encontrado.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor en el puerto ${PORT}`));
