<template>
  <!--
    The shell skip link focuses this landmark (WCAG 2.4.1). tabindex -1
    keeps it out of the tab order, so the next Tab continues inside.
    The outline is off: this is not a control, and a ring around the
    whole page would sit under the phone bar.
  -->
  <main
    id="main-content"
    tabindex="-1"
    class="outline-none"
  >
    <slot />
  </main>
</template>
