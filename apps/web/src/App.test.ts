import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import HomeView from "./views/HomeView.vue";

describe("HomeView", () => {
  it("zeigt den Titel an", () => {
    const wrapper = mount(HomeView);
    expect(wrapper.text()).toContain("Bingo Card Generator");
  });
});
