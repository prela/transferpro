<template>
  <!--
    `/settings` is not a second copy of the tabs. The parent redirects every
    Tenant role to Profile before this child is shown. This root exists only
    so the route matches; a child redirect can override the parent's
    signed-out redirect to `/`.
  -->
  <div />
</template>
