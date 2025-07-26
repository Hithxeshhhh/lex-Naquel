const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required',
      error: 'MISSING_TOKEN'
    });
  }

  if (token !== process.env.BEARER_TOKEN) {
    return res.status(403).json({
      success: false,
      message: 'Invalid access token',
      error: 'INVALID_TOKEN'
    });
  }

  next();
};

module.exports = { authenticateToken }; 