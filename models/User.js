// models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  fullName: String,
  username: String,
  location: {
    type: Map,
    of: String
  },
  mostStarredRepo: {
    name: String,
    stars: Number
  },
  mostForkedRepo: {
    name: String,
    forks: Number
  },
  email: String,
  isEmailFromCommit: Boolean,
  query: String,
  pageNum: Number,
  pageSize: Number
});

export default mongoose.model('User', userSchema);
