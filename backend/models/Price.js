const mongoose = require('mongoose');

const priceSchema = new mongoose.Schema({
  uniqueCode: {
    type: String,
    required: true,
    unique: true
  },
  price: {
    type: Number,
    required: true
  },
  resultDate: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Price', priceSchema);
