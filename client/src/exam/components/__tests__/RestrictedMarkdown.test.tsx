import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RestrictedMarkdown } from "../RestrictedMarkdown";

describe("RestrictedMarkdown component", () => {
  it("T9: renders a potential HTML injection as inert text, never as markup", () => {
    render(<RestrictedMarkdown text="<img src=x onerror=alert(1)> then `safe`" />);
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("safe").tagName).toBe("CODE");
  });
});
