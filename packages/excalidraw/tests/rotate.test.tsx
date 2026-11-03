import React from "react";
import { expect } from "vitest";

import { reseed } from "@excalidraw/common";

import { pointFrom, type GlobalPoint, type LocalPoint } from "@excalidraw/math";
import {
  distanceToElement,
  getBindingGap,
  getGlobalFixedPointForBindableElement,
} from "@excalidraw/element";

import { Excalidraw } from "../index";

import { UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

unmountComponent();

beforeEach(() => {
  localStorage.clear();
  reseed(7);
});

test("unselected bound arrow updates when rotating its target element", async () => {
  await render(<Excalidraw />);
  const rectangle = UI.createElement("rectangle", {
    width: 200,
    height: 100,
  });
  const arrow = UI.createElement("arrow", {
    x: -80,
    y: 50,
    width: 85,
    height: 0,
  });

  expect(arrow.endBinding?.elementId).toEqual(rectangle.id);

  UI.rotate(rectangle, [60, 36], { shift: true });

  expect(arrow.endBinding?.elementId).toEqual(rectangle.id);
  expect(arrow.x).toBeCloseTo(-80);
  expect(arrow.y).toBeCloseTo(50);
  expect(arrow.width).toBeCloseTo(132.491, 1);
  expect(arrow.height).toBeCloseTo(82.267, 1);
});

test("unselected bound arrows update when rotating their target elements", async () => {
  await render(<Excalidraw />);
  const ellipse = UI.createElement("ellipse", {
    x: 0,
    y: 80,
    width: 300,
    height: 120,
  });
  const ellipseArrow = UI.createElement("arrow", {
    x: -10,
    y: 80,
    width: 50,
    height: 60,
  });
  const text = UI.createElement("text", {
    position: 220,
  });
  await UI.editText(text, "test");
  const textArrow = UI.createElement("arrow", {
    x: 360,
    y: 300,
    width: -140,
    height: -60,
  });

  expect(ellipseArrow.endBinding?.elementId).toEqual(ellipse.id);
  expect(textArrow.endBinding?.elementId).toEqual(text.id);
  const originalEllipseEnd = pointFrom<LocalPoint>(
    ellipseArrow.points[1][0],
    ellipseArrow.points[1][1],
  );
  const originalTextEnd = pointFrom<LocalPoint>(
    textArrow.points[1][0],
    textArrow.points[1][1],
  );

  UI.rotate([ellipse, text], [-82, 23], { shift: true });

  expect(ellipseArrow.endBinding?.elementId).toEqual(ellipse.id);
  expect(ellipseArrow.x).toEqual(-10);
  expect(ellipseArrow.y).toEqual(80);
  expect(ellipseArrow.points[0]).toEqual([0, 0]);
  expect(ellipseArrow.points[1]).not.toEqual(originalEllipseEnd);

  expect(textArrow.endBinding?.elementId).toEqual(text.id);
  expect(textArrow.x).toEqual(360);
  expect(textArrow.y).toEqual(300);
  expect(textArrow.points[0]).toEqual([0, 0]);
  expect(textArrow.points[1]).not.toEqual(originalTextEnd);

  const elementsMap = window.h.app.scene.getNonDeletedElementsMap();
  for (const [target, arrow] of [
    [ellipse, ellipseArrow],
    [text, textArrow],
  ] as const) {
    expect(target.angle).not.toBe(0);
    const endpoint = pointFrom<GlobalPoint>(
      arrow.x + arrow.points[1][0],
      arrow.y + arrow.points[1][1],
    );
    const binding = arrow.endBinding!;
    if (binding.mode === "inside") {
      const fixedPoint = getGlobalFixedPointForBindableElement(
        binding.fixedPoint,
        target,
        elementsMap,
      );
      expect(endpoint[0]).toBeCloseTo(fixedPoint[0]);
      expect(endpoint[1]).toBeCloseTo(fixedPoint[1]);
    } else {
      expect(
        distanceToElement(target, elementsMap, endpoint),
      ).toBeLessThanOrEqual(getBindingGap(target, arrow) + 1);
    }
  }
});
