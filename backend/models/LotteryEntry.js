const mongoose = require('mongoose');

const lotteryEntrySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  series: {
    type: String,
    required: true
  },
  number: {
    type: String,
    required: true
  },
  boxValue: {
    type: String,
    required: true
  },
  uniqueCode: {
    type: String,
    unique: true,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'expired'],
    default: 'pending'
  },
  sentToParent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  sentAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('LotteryEntry', lotteryEntrySchema);
