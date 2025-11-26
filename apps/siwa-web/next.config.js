/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "uxwing.com",
        pathname: "/wp-content/themes/uxwing/download/**",
      },
      {
        protocol: "https",
        hostname: "blog.christianperone.com",
        pathname: "/wp-content/uploads/**",
      },
      {
        protocol: "https",
        hostname: "registry.npmmirror.com",
        pathname: "/@lobehub/icons-static-png/**",
      },
    ],
  },
};

module.exports = nextConfig;
