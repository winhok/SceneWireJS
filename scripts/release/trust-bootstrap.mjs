import { packages, repository, environment } from './inventory.mjs';
// Printing is the only operation. npm --dry-run is not used for trust mutations.
for (const name of packages) {
  console.log(
    `npm trust github ${name} --repo ${repository} --file npm-release.yml --env ${environment} --allow-publish`,
  );
  console.log(`npm trust list ${name}`);
}
console.log(
  '# Dist-tag manageDistTags permission requires separate owner activation; inspect current npm help/UI.',
);
