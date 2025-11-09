const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  username: String,
  text: String,
  createdAt: { type: Date, default: Date.now },
});

const postSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    authorName: String,
    content: { type: String, default: "" },
    image: { type: String, default: "" }, // cloudinary url
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // store user ids who liked
    comments: [commentSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Post", postSchema);
