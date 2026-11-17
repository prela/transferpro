<template>
  <!--
    Phone layout. Home, sign-in, and Driver Home stay in the narrow column.
    This layout does not add an office shell. The safe-area padding is on
    this wrapper, once, so a session banner and the Driver header do not
    each add the top inset (issue #567). With nothing to say, the session
    banner renders no element, so sign-in keeps its own frame.
  -->
  <div class="tp-safe-page">
    <SessionLifetime phone />
    <slot />
  </div>
</template>
