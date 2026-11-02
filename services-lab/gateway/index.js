// gateway/index.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const SERVICES = {
  students: "http://localhost:4001",
};

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }

  try {
    const token = authHeader.split(" ")[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
    });
  }
}

app.use("/api/v1/students", authenticate, async (req, res) => {
  try {
    const response = await axios({
      method: req.method,
      url: `${SERVICES.students}${req.originalUrl.replace("/api/v1", "")}`,
      data: req.body,
      timeout: 3000,
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    return res.status(503).json({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Student service is currently unavailable",
      },
    });
  }
});

app.listen(3000, () => console.log("API Gateway running on port 3000"));
