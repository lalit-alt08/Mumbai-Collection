import { cloneElement, isValidElement, useRef } from "react";

const supportsIOSSwitchHaptics = (() => {
  if (typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent || "";
  const isIOSDevice =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIOSDevice) return false;

  const versionMatch =
    userAgent.match(/(?:CPU (?:iPhone )?OS|iPhone OS|OS)\s*(\d+)[._](\d+)/i) ||
    userAgent.match(/Version\/(\d+)\.(\d+)/i);
  if (!versionMatch) return false;

  const major = Number(versionMatch[1]);
  const minor = Number(versionMatch[2]);
  return major > 17 || (major === 17 && minor >= 4);
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
  if (!supportsIOSSwitchHaptics || disabled) return children;

  const handleSwitchClick = (event) => {
    // The native switch itself supplies the iOS haptic. Stop its click from
    // reaching parent cards, then forward the action to the original control
    // after the browser has completed the switch's native toggle behavior.
    event.stopPropagation();
    if (disabled) return;

    const target = targetRef.current;
    window.setTimeout(() => {
      if (
        target?.isConnected &&
        !target.disabled &&
        target.getAttribute("aria-disabled") !== "true"
      ) {
        target.click();
      }
    }, 0);
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
        className="haptic-tap-target__switch"
        onClick={handleSwitchClick}
      />
    </span>
  );
}
