const localAiEnabled = process.env.EXPO_PUBLIC_WAFRA_LOCAL_AI_EVAL === '1';

module.exports = {
  dependencies: localAiEnabled
    ? {}
    : {
        'llama.rn': {
          platforms: {
            android: null,
            ios: null,
          },
        },
      },
};
