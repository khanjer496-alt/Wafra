export const ASC_CLI_VERSION = '4.4.2';
export const ASC_METADATA_CONFIRMATION = 'APPLY_REVIEWED_APPLE_METADATA';
export const ASC_SCREENSHOT_CONFIRMATION = 'UPLOAD_REVIEWED_APPLE_SCREENSHOTS';

const command = (label, args) => ({ label, args });

export const buildAppStoreConnectPlan = (task, context) => {
  const common = ['--app', context.appId];
  const version = ['--version', context.version];

  const plans = {
    auth: {
      commands: [
        command('Show App Store Connect authentication sources', ['auth', 'status', '--output', 'table']),
        command('Validate Wafra access against Apple', ['apps', 'view', '--id', context.appId, '--output', 'table']),
      ],
    },
    'auth-doctor': {
      commands: [
        command('Diagnose all authentication profiles', ['auth', 'doctor']),
      ],
    },
    diagnose: {
      commands: [
        command('List TestFlight builds', ['builds', 'list', ...common, ...version, '--sort', '-uploadedDate', '--limit', '10', '--output', 'table']),
        command('Show App Review status', ['review', 'status', ...common, ...version, '--output', 'table']),
        command('Diagnose App Review blockers', ['review', 'doctor', ...common, ...version, '--output', 'table']),
      ],
    },
    feedback: {
      commands: [
        command('List recent TestFlight feedback', ['testflight', 'feedback', 'list', ...common, '--sort', '-createdDate', '--limit', '25', '--output', 'table']),
      ],
    },
    'subscriptions-audit': {
      commands: [
        command('List Apple subscription groups and versions', [
          'subscriptions', 'groups', 'list', ...common,
          '--include', 'subscriptions,versions',
          '--fields', 'referenceName,subscriptions,versions',
          '--version-fields', 'version,state',
          '--versions-limit', '50',
          '--paginate',
          '--output', 'json',
          '--pretty',
        ]),
      ],
    },
    'metadata-validate': {
      requiredPaths: [context.metadataDir],
      commands: [
        command('Validate generated Apple metadata', ['metadata', 'validate', '--dir', context.metadataDir, '--output', 'table']),
      ],
    },
    'metadata-preview': {
      requiredPaths: [context.metadataDir],
      commands: [
        command('Preview Apple metadata changes', ['metadata', 'push', ...common, ...version, '--platform', 'IOS', '--dir', context.metadataDir, '--dry-run', '--output', 'table']),
      ],
    },
    'metadata-apply': {
      confirmation: ASC_METADATA_CONFIRMATION,
      requiredPaths: [context.metadataDir],
      commands: [
        command('Apply reviewed Apple metadata', ['metadata', 'push', ...common, ...version, '--platform', 'IOS', '--dir', context.metadataDir, '--output', 'table']),
      ],
    },
    'screenshots-preview': {
      requiredPaths: [context.screenshotsDir],
      commands: [
        command('Preview Apple screenshot uploads', ['screenshots', 'upload', ...common, ...version, '--platform', 'IOS', '--path', context.screenshotsDir, '--device-type', 'IPHONE_69', '--max-screenshots', '10', '--skip-existing', '--dry-run', '--output', 'table']),
      ],
    },
    'screenshots-apply': {
      confirmation: ASC_SCREENSHOT_CONFIRMATION,
      requiredPaths: [context.screenshotsDir],
      commands: [
        command('Upload reviewed Apple screenshots', ['screenshots', 'upload', ...common, ...version, '--platform', 'IOS', '--path', context.screenshotsDir, '--device-type', 'IPHONE_69', '--max-screenshots', '10', '--skip-existing', '--output', 'table']),
      ],
    },
  };

  return plans[task] ?? null;
};
