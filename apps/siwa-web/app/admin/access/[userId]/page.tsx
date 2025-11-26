import AccessManager from "./AccessManager";

type Params = { params: Promise<{ userId: string }> };

export default async function AdminAccessPage({ params }: Params) {
  const { userId } = await params;
  return <AccessManager userId={userId} />;
}
