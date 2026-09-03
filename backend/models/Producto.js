const mongoose = require('mongoose');

const ProductoSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre del producto es obligatorio'],
      trim: true,
      maxlength: [120, 'El nombre no puede exceder los 120 caracteres']
    },
    descripcion: {
      type: String,
      required: [true, 'La descripción es obligatoria'],
      trim: true,
      maxlength: [1000, 'La descripción no puede exceder los 1000 caracteres']
    },
    precio: {
      type: Number,
      default: null,
      min: [0, 'El precio no puede ser negativo'],
      set: v => (v === null || v === undefined || isNaN(v) || v === '' ? null : Math.round(v * 100) / 100)
    },
    categoria: {
      type: String,
      required: [true, 'La categoría es obligatoria'],
      uppercase: true,
      trim: true,
      enum: {
        values: [
          'DTF TEXTIL / UV',
          'SUBLIMACION',
          'SUBLIMACIÓN',
          'LONA',
          'COROPLAST',
          'CORTE LASER',
          'CORTELASER',
          'VINIL'
        ],
        message: '{VALUE} no es una categoría válida'
      },
      index: true
    },
    tipoArchivo: {
      type: String,
      required: true,
      enum: ['imagen', 'video', 'pdf']
    },
    archivoUrl: {
      type: String,
      required: [true, 'La URL del archivo es obligatoria'],
      trim: true
    },
    activo: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ÍNDICES DE RENDIMIENTO
ProductoSchema.index({ categoria: 1, createdAt: -1 });
ProductoSchema.index({ activo: 1, categoria: 1 });
ProductoSchema.index({ nombre: 'text', descripcion: 'text' });

// VIRTUAL: Convierte URLs relativas a absolutas automáticamente para GitHub Pages
ProductoSchema.virtual('fullArchivoUrl').get(function () {
  if (!this.archivoUrl) return '';
  if (this.archivoUrl.startsWith('http://') || this.archivoUrl.startsWith('https://')) {
    return this.archivoUrl;
  }
  const baseUrl = process.env.RENDER_EXTERNAL_URL || 'https://laserprint-api.onrender.com';
  const cleanPath = this.archivoUrl.startsWith('/') ? this.archivoUrl : `/${this.archivoUrl}`;
  return `${baseUrl}${cleanPath}`;
});

// LIMPIEZA AL ENVIAR JSON AL FRONTEND
ProductoSchema.method('toJSON', function () {
  const { __v, _id, ...object } = this.toObject();
  object.id = _id;
  return object;
});

module.exports = mongoose.model('Producto', ProductoSchema);
