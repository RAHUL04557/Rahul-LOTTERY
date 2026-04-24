const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  rate: {
    type: Number,
    default: 0
  },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'seller'],
    default: 'seller'
  },
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Method to get hierarchy
userSchema.methods.getHierarchy = async function() {
  const hierarchy = [this._id];
  let current = this;
  
  while (current.parentId) {
    hierarchy.unshift(current.parentId);
    current = await mongoose.model('User').findById(current.parentId);
    if (!current) break;
  }
  
  return hierarchy;
};

module.exports = mongoose.model('User', userSchema);
