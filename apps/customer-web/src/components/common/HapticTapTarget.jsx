import { cloneElement, isValidElement, useRef } from "react";

const supportsIOSSwitchHaptics = (() => {
  if (typeof navigator === "undefined") return false;

  // Prefer the standard API if Apple adds support in the future. Rendering
  // both paths would otherwise produce two tactile responses for one tap.
  if ("vibrate" in navigator) return false;

  const userAgent = navigator.userAgent || "";
  // WebKit documents switch haptics for iPhone. iPad and iPod do not have the
  // same Taptic Engine behavior, so do not add an invisible forwarding layer.
  if (!/iPhone/i.test(userAgent)) return false;

  const versionMatch =
    userAgent.match(/(?:CPU (?:iPhone )?OS|iPhone OS|OS)\s*(\d+)[._](\d+)/i) ||
    userAgent.match(/Version\/(\d+)\.(\d+)/i);
  if (!versionMatch) return false;

  const major = Number(versionMatch[1]);
  return major >= 18;
})();

/**
 * Adds iOS Safari's native switch tick to a real pointer tap while preserving
 * the wrapped button/link's existing action. Unsupported browsers fall back to
 * the wrapped control as usual; Android haptics remain in triggerHaptic().
 */
export default function HapticTapTarget({
  children,
  className = "",
  radius = "0px",
  enabled = true,
}) {
  const targetRef = useRef(null);

  if (!isValidElement(children)) return children;

  const originalRef = children.props.ref;
  const setTargetRef = (node) => {
    targetRef.current = node;
    if (typeof originalRef === "function") originalRef(node);
    else if (originalRef && typeof originalRef === "object") originalRef.current = node;
  };

  const disabled =
    !enabled ||
    Boolean(children.props.disabled) ||
    children.props["aria-disabled"] === true ||
    children.props["aria-disabled"] === "true";

  // Keep all non-iOS browsers and older iOS versions on the original DOM and
  // click path; Android continues using the existing Vibration API helper.
  if (!supportsIOSSwitchHaptics) {
    if (className) {
      return cloneElement(children, {
        className: `${children.props.className || ""} ${className}`.trim(),
      });
    }
    return children;
  }

  const handleSwitchChange = (event) => {
    // `change` fires after the native switch has toggled. Forward within the
    // same user-activation task so clipboard, media and popup-capable handlers
    // do not inherit the reliability problems of a timer-delayed click.
    event.stopPropagation();
    if (disabled) return;

    const target = targetRef.current;
    if (
      target?.isConnected &&
      !target.disabled &&
      target.getAttribute("aria-disabled") !== "true"
    ) {
      target.click();
    }
  };

  return (
    <span
      className={`haptic-tap-target ${className}`}
      style={{ "--haptic-target-radius": radius }}
    >
      {cloneElement(children, { ref: setTargetRef })}
      <input
        aria-hidden="true"
        tabIndex={-1}
        type="checkbox"
        switch=""
        disabled={disabled}
        className="haptic-tap-target__switch"
        onClick={(event) => event.stopPropagation()}
        onChange={handleSwitchChange}
      />
    </span>
  );
}
