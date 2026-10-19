const mongoose = require('mongoose');

const ProductoSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre del producto es obligatorio.'],
      trim: true,
      maxlength: [120, 'El nombre no puede pasar de 120 caracteres.']
    },
    descripcion: {
      type: String,
      required: [true, 'La descripción es obligatoria.'],
      trim: true,
      maxlength: [1000, 'La descripción no puede pasar de 1000 caracteres.']
    },
    precio: {
      type: Number,
      default: null,
      min: [0, 'El precio no puede ser negativo.'],
      set: v => (v === null || v === undefined || v === '' || isNaN(v) ? null : Math.round(Number(v) * 100) / 100)
    },
    categoria: {
      type: String,
      required: [true, 'La sección es obligatoria.'],
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
        message: '"{VALUE}" no es una sección válida.'
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
      required: [true, 'La URL del archivo es obligatoria.'],
      trim: true
    },
    // Datos internos para poder borrar el archivo de Cloudinary.
    // No se envían al sitio público.
    archivoPublicId: {
      type: String,
      default: null
    },
    archivoRecurso: {
      type: String,
      enum: ['image', 'video', 'raw', null],
      default: null
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

// ÍNDICES
ProductoSchema.index({ categoria: 1, createdAt: -1 });
ProductoSchema.index({ activo: 1, categoria: 1 });
ProductoSchema.index({ nombre: 'text', descripcion: 'text' });

// URL completa aunque se haya guardado una ruta relativa
ProductoSchema.virtual('fullArchivoUrl').get(function () {
  if (!this.archivoUrl) return '';
  if (/^https?:\/\//i.test(this.archivoUrl)) return this.archivoUrl;
  const base = process.env.RENDER_EXTERNAL_URL || 'https://laserprint-api.onrender.com';
  return base + (this.archivoUrl.startsWith('/') ? '' : '/') + this.archivoUrl;
});

// Limpieza al enviar JSON: quita campos internos y agrega "id"
ProductoSchema.method('toJSON', function () {
  const { __v, archivoPublicId, archivoRecurso, ...objeto } = this.toObject();
  objeto.id = objeto._id;
  return objeto;
});

module.exports = mongoose.model('Producto', ProductoSchema);
