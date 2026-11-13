# Generates a throwaway Xcode project with ONE UI-test bundle (no app target), so xcodebuild can run it on the
# simulator. Test-only; lives on the side branch and is never shipped.
require 'xcodeproj'
dir = ARGV[0]
proj = Xcodeproj::Project.new(File.join(dir, 'WafraPurchase.xcodeproj'))
target = proj.new_target(:ui_test_bundle, 'WafraPurchaseUITests', :ios, '17.0')
ref = proj.main_group.new_file('PurchaseUITests.swift')
target.add_file_references([ref])
target.build_configurations.each do |c|
  c.build_settings.merge!(
    'SWIFT_VERSION' => '5.0', 'GENERATE_INFOPLIST_FILE' => 'YES',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'dev.wafra.purchaseuitests', 'PRODUCT_NAME' => '$(TARGET_NAME)',
    'CODE_SIGNING_ALLOWED' => 'NO', 'CODE_SIGNING_REQUIRED' => 'NO', 'TARGETED_DEVICE_FAMILY' => '1',
    'ENABLE_TESTING_SEARCH_PATHS' => 'YES', 'SDKROOT' => 'iphoneos', 'SUPPORTED_PLATFORMS' => 'iphoneos iphonesimulator',
    'IPHONEOS_DEPLOYMENT_TARGET' => '17.0')
end
proj.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target, false)
scheme.add_test_target(target)
scheme.save_as(proj.path, 'WafraPurchase', true)
puts "wrote #{proj.path}"
