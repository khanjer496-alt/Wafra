package app.wafra.qa;

import android.os.Bundle;
import android.os.SystemClock;
import android.util.Base64;
import android.view.accessibility.AccessibilityNodeInfo;

import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** Temporary QA helper. Replaces a focused Wafra field; never submits it. */
public final class WafraTextInput extends UiAutomatorTestCase {
    private static final String WAFRA_PACKAGE = "app.wafra.android";
    private static final String EDIT_TEXT_CLASS = "android.widget.EditText";
    private static final int MAX_TEXT_BYTES = 8192;
    private static final int MAX_BASE64_CHARS = ((MAX_TEXT_BYTES + 2) / 3) * 4;
    private static final int MAX_RESOURCE_ID_CHARS = 256;
    private static final long VERIFY_TIMEOUT_MS = 1500;

    private static final class FocusedTextField extends UiObject {
        FocusedTextField(UiSelector selector) {
            super(selector);
        }

        AccessibilityNodeInfo findNow() {
            return findAccessibilityNodeInfo(0);
        }
    }

    public void testSetFocusedText() {
        try {
            setFocusedText();
        } catch (RuntimeException ignored) {
            // Framework exception messages can include view content. Do not
            // forward their message or cause into the test runner's output.
            throw new AssertionError("Wafra text input failed in the platform API.");
        }
    }

    private void setFocusedText() {
        Bundle parameters = getParams();
        require(parameters != null && parameters.containsKey("text_base64"),
                "Missing text_base64 argument.");
        String expected = decodeText(parameters.getString("text_base64"));
        String resourceId = null;
        if (parameters.containsKey("resource_id")) {
            resourceId = parameters.getString("resource_id");
            require(resourceId != null && !resourceId.isEmpty()
                            && resourceId.length() <= MAX_RESOURCE_ID_CHARS,
                    "Invalid resource_id argument.");
        }

        UiSelector selector = new UiSelector()
                .packageName(WAFRA_PACKAGE)
                .className(EDIT_TEXT_CLASS)
                .focused(true)
                .enabled(true);
        if (resourceId != null) {
            selector = selector.resourceId(resourceId);
        }

        AccessibilityNodeInfo node = new FocusedTextField(selector).findNow();
        require(node != null, "No focused Wafra EditText matched the target.");
        try {
            require(node.refresh(), "The focused target is no longer available.");
            validateTarget(node, resourceId);

            Bundle arguments = new Bundle();
            arguments.putCharSequence(
                    AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, expected);
            require(node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments),
                    "The target refused ACTION_SET_TEXT.");

            long deadline = SystemClock.uptimeMillis() + VERIFY_TIMEOUT_MS;
            do {
                require(node.refresh(), "The target disappeared before verification.");
                validateTarget(node, resourceId);
                CharSequence actual = node.getText();
                if (expected.contentEquals(actual == null ? "" : actual)) {
                    return;
                }
                SystemClock.sleep(50);
            } while (SystemClock.uptimeMillis() < deadline);
            throw new AssertionError("The target did not retain the exact requested text.");
        } finally {
            node.recycle();
        }
    }

    private static void validateTarget(AccessibilityNodeInfo node, String resourceId) {
        require(equalsText(WAFRA_PACKAGE, node.getPackageName())
                        && equalsText(EDIT_TEXT_CLASS, node.getClassName())
                        && node.isFocused() && node.isEditable()
                        && node.isEnabled() && node.isVisibleToUser(),
                "The target is not a focused, visible, editable Wafra field.");
        require(resourceId == null || resourceId.equals(node.getViewIdResourceName()),
                "The target resource ID does not match.");
    }

    private static boolean equalsText(String expected, CharSequence actual) {
        return actual != null && expected.contentEquals(actual);
    }

    private static String decodeText(String encoded) {
        require(encoded != null && encoded.length() <= MAX_BASE64_CHARS
                        && encoded.length() % 4 == 0,
                "Invalid or oversized Base64 argument.");
        final byte[] bytes;
        try {
            bytes = Base64.decode(encoded, Base64.NO_WRAP);
        } catch (IllegalArgumentException ignored) {
            throw new AssertionError("Invalid Base64 argument.");
        }
        // Android's decoder tolerates whitespace. Canonical round-trip rejects
        // that, missing padding, and non-alphabet input without echoing it.
        require(bytes.length <= MAX_TEXT_BYTES
                        && Base64.encodeToString(bytes, Base64.NO_WRAP).equals(encoded),
                "Non-canonical or oversized Base64 argument.");
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException ignored) {
            throw new AssertionError("Text must be valid UTF-8.");
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
