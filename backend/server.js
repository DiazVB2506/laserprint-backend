const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const Producto = require('./models/Producto');

const app = express();

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

// Servir estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de archivo no permitido'), false);
  }
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite 50MB
});

// Conexión MongoDB con Pool
mongoose.connect(process.env.MONGODB_URI, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(() => console.log('🟢 Base de Datos MongoDB profesional conectada'))
.catch(err => console.error('🔴 Error de conexión a BD:', err.message));

// API: OBTENER PRODUCTOS
app.get('/api/productos', async (req, res) => {
  try {
    const { categoria, page = 1, limit = 100 } = req.query;
    
    const filtro = { activo: true };
    if (categoria) filtro.categoria = categoria;

    const productos = await Producto.find(filtro)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
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

// API: GUARDAR REGISTRO (CON VALIDACIÓN DE CAMPOS Y PRECIO)
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

    const archivoUrl = `http://localhost:5000/uploads/${subcarpeta}/${req.file.filename}`;

    // Manejo de precio seguro contra NaN
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

// API: ELIMINAR REGISTRO
app.delete('/api/productos/:id', async (req, res) => {
  try {
    const producto = await Producto.findByIdAndDelete(req.params.id);
    if (!producto) return res.status(404).json({ error: 'Registro no encontrado' });
    res.status(200).json({ mensaje: 'Publicación eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el registro' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor listo en el puerto ${PORT}`);
});