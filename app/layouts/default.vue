<template>
  <!--
    Phone layout. The page owns its width: Home, sign-in, and Driver Home
    stay in the narrow column. This layout does not add a shell.
    The Driver banners use that same column. With nothing to say, the
    component renders no element, so sign-in keeps its own frame.
  -->
  <SessionLifetime phone />
  <slot />
</template>
