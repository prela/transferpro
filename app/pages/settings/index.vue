<template>
  <!--
    `/settings` is not a second copy of the tabs. The parent redirects every
    Tenant role to Profile, including when this child is chosen while the
    parent stays mounted. This root exists only so the route matches; a child
    redirect can override the parent's signed-out redirect to `/`.
  -->
  <div />
</template>
