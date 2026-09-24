FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:35d40304542c8689331f8cab17c65926cdf48fe711e289321d71924b230a7d29 AS build
WORKDIR /src
COPY services/wopi/ services/wopi/
COPY apps/editor/shared/formats.json apps/editor/shared/formats.json
COPY tests/harness/ tests/harness/
RUN dotnet publish tests/harness/Office.Harness.csproj -c Release -o /out
FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:2d584d8147faddb0d678c5748d47953e5b8e18621ed4fb7049a91381d9d7746f
WORKDIR /app
COPY --from=build /out .
COPY tests/fixtures/synthetic.* /fixtures/
RUN mkdir /data && chown $APP_UID /data
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080 DataDirectory=/data FixtureDirectory=/fixtures
ENTRYPOINT ["dotnet", "Office.Harness.dll"]
