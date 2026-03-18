module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
    ],
    plugins: [
      "react-native-reanimated/plugin",
      [
        "module-resolver",
        {
          root: ["./"],
          alias: {
            "@": "./src",
            "@db": "./src/db",
            "@api": "./src/api",
            "@store": "./src/store",
            "@components": "./src/components",
            "@hooks": "./src/hooks",
            "@mtgtypes": "./src/types",
          },
        },
      ],
    ],
  };
};
