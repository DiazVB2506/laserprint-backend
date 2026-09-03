const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const Producto = require('./models/Producto');

const app = express();

// Configuración CORS mejorada para producción
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CREAR CARPETAS DE ALMACENAMIENTO AUTOMÁTICAMENTE SI NO EXISTEN
const carpetas = ['uploads/fotos', 'uploads/videos', 'uploads/documentos'];
carpetas.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`📁 Carpeta creada: ${dir}`);
  }
});

// 1. SERVIR ARCHIVOS SUBIDOS (UPLOADS)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 2. SERVIR ARCHIVOS ESTÁTICOS DEL FRONTEND (OPCIONAL EN MONOREPO LOCAL)
const frontendPath = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
}

// Configuración de Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'fotos';
    if (file.mimetype.startsWith('video/')) folder = 'videos';
    if (file.mimetype === 'application/pdf') folder = 'documentos';
    cb(null, path.join(__dirname, `uploads/${folder}`));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de archivo no permitido. Solo se aceptan imágenes, MP4 o PDF.'), false);
  }
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite 50MB
});

// Conexión MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/laserprint';

mongoose.connect(MONGODB_URI, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(() => console.log('🟢 Base de Datos MongoDB conectada correctamente'))
.catch(err => console.error('🔴 Error de conexión a BD:', err.message));

// ==========================================================================
// API: AUTENTICACIÓN (LOGIN)
// ==========================================================================
app.post('/api/login', (req, res) => {
  const usuario = req.body.usuario || req.body.username;
  const password = req.body.password;

  if (usuario === '2025' && password === 'LaserPrint01') {
    return res.status(200).json({ 
      success: true, 
      message: 'Autenticación exitosa' 
    });
  }

  return res.status(401).json({ 
    success: false, 
    message: 'Usuario o contraseña incorrectos.' 
  });
});

// ==========================================================================
// API: OBTENER PRODUCTOS
// ==========================================================================
app.get('/api/productos', async (req, res) => {
  try {
    const { categoria, page = 1, limit = 100 } = req.query;
    
    const filtro = { activo: true };
    if (categoria) filtro.categoria = categoria;

    const productos = await Producto.find(filtro)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const total = await Producto.countDocuments(filtro);

    res.status(200).json({
      total,
      paginaActual: parseInt(page),
      totalPaginas: Math.ceil(total / limit),
      productos
    });
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).json({ error: 'Error al consultar catálogo', detalle: error.message });
  }
});

// ==========================================================================
// API: GUARDAR REGISTRO NUEVO
// ==========================================================================
app.post('/api/productos', upload.single('archivo'), async (req, res) => {
  try {
    const { nombre, descripcion, precio, categoria } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Debes seleccionar un archivo válido' });
    }

    let tipoArchivo = 'imagen';
    let subcarpeta = 'fotos';

    if (req.file.mimetype.startsWith('video/')) {
      tipoArchivo = 'video';
      subcarpeta = 'videos';
    } else if (req.file.mimetype === 'application/pdf') {
      tipoArchivo = 'pdf';
      subcarpeta = 'documentos';
    }

    const hostUrl = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
    const archivoUrl = `${hostUrl}/uploads/${subcarpeta}/${req.file.filename}`;

    let precioNumerico = null;
    if (precio !== undefined && precio !== null && precio !== '' && !isNaN(precio)) {
      precioNumerico = parseFloat(precio);
    }

    const nuevoProducto = new Producto({
      nombre,
      descripcion,
      precio: precioNumerico,
      categoria,
      tipoArchivo,
      archivoUrl
    });

    await nuevoProducto.save();
    console.log('✅ Publicación guardada en BD:', nuevoProducto.nombre);
    
    res.status(201).json({ mensaje: 'Publicación guardada exitosamente', producto: nuevoProducto });
  } catch (error) {
    console.error('Error al guardar en BD:', error);
    res.status(400).json({ error: 'Error de validación al guardar', detalle: error.message });
  }
});

// ==========================================================================
// API: ACTUALIZAR REGISTRO (EDICIÓN)
// ==========================================================================
app.put('/api/productos/:id', upload.single('archivo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, precio, categoria } = req.body;

    const productoExistente = await Producto.findById(id);
    if (!productoExistente) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    let precioNumerico = null;
    if (precio !== undefined && precio !== null && precio !== '' && !isNaN(precio)) {
      precioNumerico = parseFloat(precio);
    }

    const camposActualizar = {
      nombre,
      descripcion,
      precio: precioNumerico,
      categoria
    };

    if (req.file) {
      let tipoArchivo = 'imagen';
      let subcarpeta = 'fotos';

      if (req.file.mimetype.startsWith('video/')) {
        tipoArchivo = 'video';
        subcarpeta = 'videos';
      } else if (req.file.mimetype === 'application/pdf') {
        tipoArchivo = 'pdf';
        subcarpeta = 'documentos';
      }

      if (productoExistente.archivoUrl) {
        const urlPath = new URL(productoExistente.archivoUrl, 'http://localhost').pathname;
        const cleanOldPath = urlPath.replace(/^\//, '');
        const oldFilePath = path.join(__dirname, cleanOldPath);
        if (fs.existsSync(oldFilePath)) {
          try { fs.unlinkSync(oldFilePath); } catch (e) { console.warn('No se pudo borrar archivo viejo:', e.message); }
        }
      }

      const hostUrl = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
      camposActualizar.tipoArchivo = tipoArchivo;
      camposActualizar.archivoUrl = `${hostUrl}/uploads/${subcarpeta}/${req.file.filename}`;
    }

    const productoActualizado = await Producto.findByIdAndUpdate(
      id,
      camposActualizar,
      { new: true, runValidators: true }
    );

    console.log('✏️ Publicación actualizada en BD:', productoActualizado.nombre);
    res.status(200).json({ mensaje: 'Publicación actualizada correctamente', producto: productoActualizado });
  } catch (error) {
    console.error('Error al actualizar en BD:', error);
    res.status(500).json({ error: 'Error al actualizar la publicación', detalle: error.message });
  }
});

// ==========================================================================
// API: ELIMINAR REGISTRO Y ARCHIVO FÍSICO
// ==========================================================================
app.delete('/api/productos/:id', async (req, res) => {
  try {
    const producto = await Producto.findByIdAndDelete(req.params.id);
    if (!producto) return res.status(404).json({ error: 'Registro no encontrado' });
    
    if (producto.archivoUrl) {
      try {
        const urlPath = new URL(producto.archivoUrl, 'http://localhost').pathname;
        const cleanRelativePath = urlPath.replace(/^\//, '');
        const filePath = path.join(__dirname, cleanRelativePath);
        
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.warn('Error al borrar archivo físico:', e.message);
      }
    }

    res.status(200).json({ mensaje: 'Publicación eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el registro' });
  }
});

// MIDDLEWARE DE CAPTURA DE ERRORES DE MULTER
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Error de subida: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// FALLBACK DE RUTAS
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return res.status(404).json({ error: 'Recurso API no encontrado' });
  }
  
  const indexPath = path.join(__dirname, '..', 'frontend', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  
  res.status(200).json({ status: 'API LaserPrint Operativa' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
