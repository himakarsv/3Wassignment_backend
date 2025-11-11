const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const Post = require("../models/Post");
const User = require("../models/User");
const multer = require("multer");
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Create post (text, image, or both). either field allowed
// router.post("/", auth, upload.single("image"), async (req, res) => {
//   try {
//     let imageUrl = "";
//     if (req.file) {
//       // upload buffer to Cloudinary
//       const stream = cloudinary.uploader.upload_stream(
//         { folder: "mini-social" },
//         (error, result) => {
//           if (error)
//             return res
//               .status(500)
//               .json({ message: "Image upload failed", error });
//           // result.secure_url
//         }
//       );
//       // we will use a promise wrapper
//       const uploadFromBuffer = (fileBuffer) => {
//         return new Promise((resolve, reject) => {
//           const uploadStream = cloudinary.uploader.upload_stream(
//             { folder: "mini-social" },
//             (err, result) => {
//               if (err) return reject(err);
//               resolve(result);
//             }
//           );
//           streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
//         });
//       };
//       const result = await uploadFromBuffer(req.file.buffer);
//       imageUrl = result.secure_url;
//     }

//     const user = await User.findById(req.user.id);
//     const post = new Post({
//       authorId: req.user.id,
//       authorName: req.user.username,
//       content: req.body.content || "",
//       image: imageUrl,
//     });
//     await post.save();

//     // populate minimal user info if necessary
//     const created = await Post.findById(post._id);

//     // emit socket event via req.app.get('io')
//     const io = req.app.get("io");
//     if (io) io.emit("new-post", created);

//     res.json(created);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Server error" });
//   }
// });
function uploadBufferToCloudinary(buffer, options = { folder: "mini-social" }) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

// Create post (text, image, or both). either field allowed
router.post("/", auth, upload.single("image"), async (req, res) => {
  try {
    let imageUrl = "";

    if (req.file && req.file.buffer) {
      // uploadFromBuffer using the helper above
      const result = await uploadBufferToCloudinary(req.file.buffer);
      imageUrl = result?.secure_url || "";
    }

    // create post document
    const post = new Post({
      authorId: req.user.id,
      authorName: req.user.username,
      content: req.body.content || "",
      image: imageUrl,
    });
    await post.save();

    // fetch created post (optionally populate if needed)
    const created = await Post.findById(post._id).lean();

    // emit socket event (if socket exists)
    const io = req.app.get("io");
    if (io) io.emit("new-post", created);

    return res.json(created);
  } catch (err) {
    console.error("Create post error:", err);

    // Try to send a single error response
    // If headers were already sent, just end the function (avoid crashing)
    if (res.headersSent) {
      // headers already sent; nothing more we can do here
      console.warn("Headers already sent while handling post creation error.");
      return;
    }

    // Send an appropriate error response
    return res.status(500).json({
      message: "Server error while creating post",
      error: err?.message || err,
    });
  }
});
// Get feed with simple pagination
router.get("/", auth, async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;

    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({ posts, page, limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Like/unlike
router.post("/:postId/like", auth, async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const idx = post.likes.findIndex((id) => id.toString() === req.user.id);
    if (idx === -1) {
      post.likes.push(req.user.id);
    } else {
      post.likes.splice(idx, 1);
    }
    await post.save();

    const io = req.app.get("io");
    if (io) io.emit("post-updated", post);

    res.json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Comment
router.post("/:postId/comment", auth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: "Empty comment" });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    post.comments.push({
      userId: req.user.id,
      username: req.user.username,
      text,
    });
    await post.save();

    const io = req.app.get("io");
    if (io) io.emit("post-updated", post);

    res.json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
// DELETE post (only by author)
router.delete("/:postId", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    if (post.authorId.toString() !== req.user.id)
      return res.status(403).json({ message: "Unauthorized" });

    await post.deleteOne();

    // Broadcast to all clients so feed updates in real-time
    const io = req.app.get("io");
    if (io) io.emit("post-deleted", req.params.postId);

    res.json({ message: "Post deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// EDIT post (only by author)
router.put("/:postId", auth, upload.single("image"), async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    if (post.authorId.toString() !== req.user.id)
      return res.status(403).json({ message: "Unauthorized" });

    // Optional: update text
    if (req.body.content) post.content = req.body.content;

    // Optional: replace image
    if (req.file) {
      const result = await uploadBufferToCloudinary(req.file.buffer);
      post.image = result.secure_url;
    }

    await post.save();

    const io = req.app.get("io");
    if (io) io.emit("post-updated", post);

    res.json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
