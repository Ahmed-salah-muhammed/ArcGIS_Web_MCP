/** portal_whoami: the signed-in user, their organization, and what the account can do. */
import type { Ctx } from "../shared/context";
import { base } from "../shared/lookup";

export async function whoami(ctx: Ctx) {
	const me = await ctx.request(`${base(ctx)}/community/self`);
	const privileges: string[] = me.privileges ?? [];
	return {
		username: me.username, fullName: me.fullName ?? null, role: me.role ?? null, roleId: me.roleId ?? null,
		user_type: me.userLicenseTypeId ?? null, org: ctx.props.orgName, org_id: me.orgId ?? ctx.props.orgId,
		platform: ctx.props.isPortal ? "ArcGIS Enterprise" : "ArcGIS Online", portal: ctx.props.portal,
		can: {
			create_items: privileges.includes("portal:user:createItem"),
			publish_features: privileges.includes("portal:publisher:publishFeatures"),
			share_public: privileges.includes("portal:user:shareToPublic"),
		},
	};
}
