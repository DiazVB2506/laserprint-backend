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
      set: v => (v === null || v === undefined || isNaN(v) ? null : Math.round(v * 100) / 100)
    },
    categoria: {
      type: String,
      required: [true, 'La categoría es obligatoria'],
      enum: {
        values: [
          'DTF TEXTIL / UV',
          'SUBLIMACION',
          'LONA',
          'COROPLAST',
          'CORTE LASER',
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
    timestamps: true
  }
);

// Índice compuesto para acelerar consultas por categoría y orden por fecha
ProductoSchema.index({ categoria: 1, createdAt: -1 });

// Índice de búsqueda por texto en nombre y descripción
ProductoSchema.index({ nombre: 'text', descripcion: 'text' });

module.exports = mongoose.model('Producto', ProductoSchema);